import { utcMonthWindow } from '../budgetIntegrity';
import { liveSocialCapabilities, operationWriteEnabled } from './capabilities';
import { probeInstagramPermissions } from './instagram/probe';
import { instagramCommentWebhookConfirmed, instagramCommentsWebhookSourceStatus, instagramWebhookRegistrationStatus, instagramWebhookSecretsConfigured } from './instagram/commentSync';
import { readSchemaVersion, EXPECTED_SCHEMA_VERSION } from './schemaVersion';
import { loadUserBudgetCeilingUsd, serverHardLimitUsd } from './budgetCeiling';
import { loadSyncCheckpoint } from './syncCheckpoints';
import { xOAuthConfigured, xOAuthStatus, type XOAuthEnv } from '../xOAuth';

export interface PreflightEnv extends XOAuthEnv {
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
  INSTAGRAM_API_VERSION?: string;
  INSTAGRAM_COMMENT_REPLY_ENABLED?: string;
  INSTAGRAM_DM_WRITE_ENABLED?: string;
  INSTAGRAM_DM_READ_ENABLED?: string;
  INSTAGRAM_WEBHOOK_VERIFY_TOKEN?: string;
  INSTAGRAM_APP_SECRET?: string;
  INSTAGRAM_COMMENT_WEBHOOK_CONFIRMED?: string;
  X_REPLY_WRITE_ENABLED?: string;
  X_FOLLOW_WRITE_ENABLED?: string;
  X_UNFOLLOW_WRITE_ENABLED?: string;
  X_LIKE_WRITE_ENABLED?: string;
  X_DM_WRITE_ENABLED?: string;
  X_DM_READ_ENABLED?: string;
  X_INBOUND_SYNC_ENABLED?: string;
  X_REPLY_WRITE_USD?: string;
  X_FOLLOW_WRITE_USD?: string;
  X_UNFOLLOW_WRITE_USD?: string;
  X_LIKE_WRITE_USD?: string;
  X_DM_WRITE_USD?: string;
  X_DM_READ_USD?: string;
  X_INBOUND_READ_USD?: string;
  X_LOOKUP_READ_USD?: string;
  X_USER_READ_USD?: string;
  X_OWNED_READ_USD?: string;
  INSTAGRAM_COMMENT_REPLY_USD?: string;
  INSTAGRAM_DM_WRITE_USD?: string;
  INSTAGRAM_DM_READ_USD?: string;
  SOCIAL_RECONCILE_READ_USD?: string;
  DEFAULT_MONTHLY_BUDGET_USD?: string;
}

interface Check {
  ok: boolean;
  severity: 'ok' | 'warn' | 'block';
  label: string;
  reason?: string;
  nextStep?: string;
}

export async function buildProductionPreflight(env: PreflightEnv, userId: string) {
  const schema = await readSchemaVersion(env.DB);
  const oauth = await xOAuthStatus(env, userId);
  const probe = await probeInstagramPermissions(env, userId);
  const capabilities = liveSocialCapabilities(env, oauth.scopes || [], probe, oauth.connected);
  const usage = await monthUsage(env.DB, userId);
  const prices = collectPrices(env);
  const unknownPrices = prices.filter((item) => item.amount == null).map((item) => item.key);

  const socialActionsReady = await tableExists(env.DB, 'social_actions');
  const executionsReady = await tableExists(env.DB, 'social_executions');
  const fingerprintReady = await columnExists(env.DB, 'social_executions', 'fingerprint_json');
  const runtimeBudgetReady = await tableExists(env.DB, 'user_runtime_settings');
  const checkpointReady = await tableExists(env.DB, 'social_sync_checkpoints');
  const xIdentityReady = await columnExists(env.DB, 'x_oauth_tokens', 'x_user_id');
  const writesEnabled = env.SOCIAL_WRITE_ENABLED === 'true' || env.SOCIAL_WRITE_MODE === 'test';
  const checks: Check[] = [];
  checks.push(schema.connected && schema.partial.length === 0 && schema.currentVersion === EXPECTED_SCHEMA_VERSION
    ? ok('database', 'D1 schema matches the expected migration version.')
    : block('database', schema.reason || `D1 is at version ${schema.currentVersion ?? 'unknown'}; expected ${EXPECTED_SCHEMA_VERSION}.`, 'Run the GitHub Action “Migrate production D1” (workflow_dispatch).'));
  checks.push(socialActionsReady
    ? ok('socialActionSchemaReady', 'social_actions table is ready.')
    : block('socialActionSchemaReady', 'social_actions table is missing.', 'Run production D1 migrations.'));
  checks.push(executionsReady
    ? ok('executionSchemaReady', 'social_executions table is ready.')
    : block('executionSchemaReady', 'social_executions table is missing.', 'Run production D1 migrations.'));
  checks.push(fingerprintReady
    ? ok('executionFingerprintReady', 'social_executions.fingerprint_json is available as the durable write authority.')
    : block('executionFingerprintReady', 'fingerprint_json is missing, so provider writes cannot be reconciled safely.', 'Run production D1 migrations through version 5 (0005_execution_fingerprint.sql).'));
  checks.push(runtimeBudgetReady
    ? ok('runtimeBudgetTableReady', 'user_runtime_settings is available for the user budget ceiling.')
    : block('runtimeBudgetTableReady', 'user_runtime_settings is missing.', 'Run production D1 migrations through version 7.'));
  checks.push(checkpointReady
    ? ok('syncCheckpointTableReady', 'social_sync_checkpoints is available.')
    : block('syncCheckpointTableReady', 'social_sync_checkpoints is missing, so provider reads fail closed.', 'Run production D1 migrations through version 6.'));
  checks.push(xIdentityReady
    ? ok('xOAuthIdentityColumnReady', 'X OAuth same-account identity column is available.')
    : block('xOAuthIdentityColumnReady', 'x_oauth_tokens.x_user_id is missing.', 'Run production D1 migrations through version 4.'));
  if (writesEnabled && !fingerprintReady) {
    checks.push(block('writeFingerprintGate', 'Production writes are enabled but durable execution fingerprints cannot be stored.', 'Keep SOCIAL_WRITE_ENABLED=false until migration 0005 is applied.'));
  }

  const scopes = oauth.scopes || [];
  checks.push(xOAuthConfigured(env)
    ? (oauth.connected ? ok('xConfigured', 'X OAuth is configured and connected.') : warn('xConfigured', 'X OAuth is configured but not connected.', 'Settings → X → 接続'))
    : block('xConfigured', 'X OAuth app credentials are incomplete.', 'Set X_CLIENT_ID, X_CLIENT_SECRET, callback URL, PWA return URL, and OAUTH_TOKEN_ENCRYPTION_KEY_B64.'));
  checks.push(flagCheck('X reply write', capabilities.x.sendReply, scopes.includes('tweet.write'), env.X_REPLY_WRITE_ENABLED === 'true', 'tweet.write', 'Settings → X → 返信権限を追加'));
  checks.push(flagCheck('X follow write', capabilities.x.follow, scopes.includes('follows.write'), env.X_FOLLOW_WRITE_ENABLED === 'true', 'follows.write', 'Settings → X → フォロー権限を追加'));
  checks.push(flagCheck('X like write', capabilities.x.like, scopes.includes('like.write'), env.X_LIKE_WRITE_ENABLED === 'true', 'like.write', 'Settings → X → いいね権限を追加'));
  checks.push(scopes.includes('like.read') && scopes.includes('like.write')
    ? ok('X like.read', 'like.read is present for official liked-state reconciliation.')
    : warn('X like.read', 'いいね reconciliation needs like.read + like.write.', 'Settings → X → いいね権限を追加 (requests like.read and like.write together).'));
  checks.push(flagCheck('X DM read', capabilities.x.readDm, scopes.includes('dm.read'), env.X_DM_READ_ENABLED === 'true' || env.X_DM_WRITE_ENABLED === 'true', 'dm.read', 'Settings → X → DM権限を追加'));
  checks.push(flagCheck('X DM write', capabilities.x.sendDm, scopes.includes('dm.write'), env.X_DM_WRITE_ENABLED === 'true', 'dm.write', 'Settings → X → DM権限を追加'));

  checks.push(probe.configured
    ? (probe.tokenValid ? ok('instagramConfigured', 'Instagram credentials are present.') : block('instagramConfigured', probe.reason || 'Instagram token is invalid.', 'Replace INSTAGRAM_ACCESS_TOKEN in Worker secrets.'))
    : warn('instagramConfigured', 'Instagram Professional credentials are not configured.', 'Set INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID, and INSTAGRAM_API_VERSION.'));
  checks.push(probe.professionalAccount
    ? ok('instagramProfessional', 'Professional account confirmed.')
    : warn('instagramProfessional', probe.reason || 'Professional account was not verified.', 'Use an Instagram Business or Creator account.'));
  checks.push(probe.readComments
    ? ok('instagramComments', 'Comment permissions were verified.')
    : warn('instagramComments', 'Comment permission is not verified.', 'Grant instagram_business_manage_comments in Meta App Review, then Settings → Instagram → 権限状態を確認.'));
  checks.push(probe.readDm
    ? ok('instagramMessages', 'Message permissions were verified.')
    : warn('instagramMessages', 'Message permission is not verified.', 'Grant instagram_business_manage_messages, then Settings → Instagram → 権限状態を確認.'));
  checks.push(capabilities.instagram.sendCommentReply
    ? ok('instagramCommentReplyReady', 'In-app Instagram comment reply is ready.')
    : warn('instagramCommentReplyReady', 'Instagram comment reply is blocked.', 'Verify comment permission, set INSTAGRAM_COMMENT_REPLY_ENABLED=true and INSTAGRAM_COMMENT_REPLY_USD=0 after confirming Meta does not bill this call, then SOCIAL_WRITE_ENABLED=true.'));
  checks.push(capabilities.instagram.sendDm
    ? ok('instagramDmWriteReady', 'In-app Instagram DM reply is ready.')
    : warn('instagramDmWriteReady', 'Instagram DM write is blocked.', 'Verify message permission, set INSTAGRAM_DM_WRITE_ENABLED=true and an explicit INSTAGRAM_DM_WRITE_USD, then SOCIAL_WRITE_ENABLED=true.'));

  for (const price of prices) {
    if (price.amount == null) {
      checks.push(warn(price.key, `${price.key} is unset, so this operation fail-closes.`, `Set ${price.key} from the current official price. Use 0 only after confirming the operation is free.`));
    } else {
      checks.push(ok(price.key, `${price.key}=${price.amount}`));
    }
  }

  const webhookSecrets = instagramWebhookSecretsConfigured(env);
  const webhookConfirmed = webhookSecrets && instagramCommentWebhookConfirmed(env);
  const webhookStatus = instagramWebhookRegistrationStatus(webhookSecrets, webhookConfirmed);
  checks.push(ok('instagramWebhookReceiverCode', 'Webhook receiver code: READY.'));
  checks.push(webhookSecrets
    ? ok('instagramWebhookSecrets', 'Webhook secrets: READY.')
    : warn('instagramWebhookSecrets', 'Webhook secrets: MISSING.', 'Set INSTAGRAM_WEBHOOK_VERIFY_TOKEN and INSTAGRAM_APP_SECRET, then register comments + live_comments in Meta App Dashboard.'));
  checks.push(webhookConfirmed
    ? ok('instagramWebhookDashboardRegistration', 'Webhook dashboard registration: CONFIRMED.')
    : warn('instagramWebhookDashboardRegistration', 'Webhook dashboard registration: UNCONFIRMED. Secret presence is not evidence of a Meta subscription.', 'After confirming comments and live_comments in Meta App Dashboard, set INSTAGRAM_COMMENT_WEBHOOK_CONFIRMED=true.'));

  const userCeiling = await loadUserBudgetCeilingUsd(env.DB, userId);
  const hardLimit = serverHardLimitUsd(env);
  checks.push(ok('userBudgetCeiling', userCeiling == null
    ? `No stored user ceiling; effective limit is the server HARD LIMIT $${hardLimit}.`
    : `User ceiling $${userCeiling}; effective limit $${Math.min(hardLimit, userCeiling)} (HARD LIMIT $${hardLimit}).`));

  const sources = await sourceStatuses(env, userId, oauth.connected, scopes, probe, webhookSecrets, webhookConfirmed);
  for (const source of sources) checks.push(source.check);

  const blocked = checks.filter((item) => item.severity === 'block');
  const warned = checks.filter((item) => item.severity === 'warn');
  return {
    ok: blocked.length === 0,
    database: {
      connected: schema.connected,
      migrationVersion: schema.currentVersion,
      expectedMigrationVersion: EXPECTED_SCHEMA_VERSION,
      pending: schema.pending,
      partial: schema.partial,
      reason: schema.reason,
    },
    x: {
      configured: xOAuthConfigured(env),
      tokenValid: oauth.connected,
      scopes,
      replyReady: capabilities.x.sendReply,
      followReady: capabilities.x.follow,
      likeReady: capabilities.x.like,
      dmReadReady: capabilities.x.readDm,
      dmWriteReady: capabilities.x.sendDm,
    },
    instagram: {
      configured: probe.configured,
      tokenValid: probe.tokenValid,
      professionalAccount: probe.professionalAccount,
      commentsPermission: probe.readComments,
      messagesPermission: probe.readDm,
      commentReplyReady: capabilities.instagram.sendCommentReply,
      dmReadReady: capabilities.instagram.readDm,
      dmWriteReady: capabilities.instagram.sendDm,
      permissionsVerified: probe.permissionsVerified,
      reason: probe.reason,
    },
    budget: {
      hardLimit: true,
      currentUsage: usage.usedUsd,
      ledgerAvailable: usage.available,
      configuredOperationPrices: Object.fromEntries(prices.filter((item) => item.amount != null).map((item) => [item.key, item.amount])),
      unknownPrices,
    },
    webhooks: {
      instagramReceiverCodeReady: true,
      instagramReceiverSecretsReady: webhookSecrets,
      instagramDashboardRegistrationConfirmed: webhookConfirmed,
      instagramReceiverReady: webhookSecrets,
      registrationDetectedIfPossible: false,
      registrationStatus: webhookStatus.dashboardRegistration,
    },
    inboxSources: Object.fromEntries(sources.map((item) => [item.id, { status: item.status, reason: item.check.reason, nextStep: item.check.nextStep }])),
    app: {
      socialActionSchemaReady: socialActionsReady,
      executionSchemaReady: executionsReady,
      executionFingerprintReady: fingerprintReady,
      runtimeBudgetTableReady: runtimeBudgetReady,
      syncCheckpointTableReady: checkpointReady,
      xOAuthIdentityColumnReady: xIdentityReady,
      socialWriteEnabled: writesEnabled,
    },
    checks,
    summary: {
      block: blocked.length,
      warn: warned.length,
      ok: checks.filter((item) => item.severity === 'ok').length,
    },
  };
}

function flagCheck(label: string, ready: boolean, hasScope: boolean, flagOn: boolean, scope: string, nextStep: string): Check {
  if (ready) return ok(label, `${label} is ready.`);
  if (!hasScope) return warn(label, `${scope} has not been granted.`, nextStep);
  if (!flagOn) return warn(label, `${label} permission is granted but the production write flag is off.`, `Set the matching *_ENABLED secret to true only after go-live review. Default stays false.`);
  return warn(label, `${label} is not ready.`, nextStep);
}

function collectPrices(env: PreflightEnv) {
  return [
    price('X_REPLY_WRITE_USD', env.X_REPLY_WRITE_USD),
    price('X_FOLLOW_WRITE_USD', env.X_FOLLOW_WRITE_USD),
    price('X_UNFOLLOW_WRITE_USD', env.X_UNFOLLOW_WRITE_USD),
    price('X_LIKE_WRITE_USD', env.X_LIKE_WRITE_USD),
    price('X_DM_WRITE_USD', env.X_DM_WRITE_USD),
    price('X_DM_READ_USD', env.X_DM_READ_USD),
    price('X_INBOUND_READ_USD', env.X_INBOUND_READ_USD),
    price('X_LOOKUP_READ_USD', env.X_LOOKUP_READ_USD ?? env.X_USER_READ_USD),
    price('X_OWNED_READ_USD', env.X_OWNED_READ_USD),
    price('INSTAGRAM_COMMENT_REPLY_USD', env.INSTAGRAM_COMMENT_REPLY_USD),
    price('INSTAGRAM_DM_WRITE_USD', env.INSTAGRAM_DM_WRITE_USD),
    price('INSTAGRAM_DM_READ_USD', env.INSTAGRAM_DM_READ_USD),
    price('SOCIAL_RECONCILE_READ_USD', env.SOCIAL_RECONCILE_READ_USD),
  ];
}

function price(key: string, raw: string | undefined) {
  if (raw == null || String(raw).trim() === '') return { key, amount: null as number | null };
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount < 0) return { key, amount: null as number | null };
  return { key, amount };
}

async function monthUsage(db: D1Database, userId: string) {
  try {
    const { start, end } = utcMonthWindow();
    const row = await db.prepare(
      'SELECT COALESCE(SUM(cost_usd), 0) AS used FROM budget_ledger WHERE user_id = ? AND julianday(occurred_at) >= julianday(?) AND julianday(occurred_at) < julianday(?)',
    ).bind(userId, start, end).first<{ used: number }>();
    return { usedUsd: Number(row?.used || 0), available: true };
  } catch {
    return { usedUsd: 0, available: false };
  }
}

async function columnExists(db: D1Database, table: string, column: string) {
  try {
    await db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).first();
    return true;
  } catch {
    return false;
  }
}

async function tableExists(db: D1Database, name: string) {
  try {
    const row = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(name).first<{ name: string }>();
    return Boolean(row?.name);
  } catch {
    return false;
  }
}

function ok(label: string, reason: string): Check {
  return { ok: true, severity: 'ok', label, reason };
}
function warn(label: string, reason: string, nextStep?: string): Check {
  return { ok: true, severity: 'warn', label, reason, nextStep };
}
function block(label: string, reason: string, nextStep?: string): Check {
  return { ok: false, severity: 'block', label, reason, nextStep };
}

async function sourceStatuses(
  env: PreflightEnv,
  userId: string,
  xConnected: boolean,
  scopes: string[],
  probe: Awaited<ReturnType<typeof probeInstagramPermissions>>,
  webhookSecrets: boolean,
  webhookConfirmed: boolean,
) {
  const xMentionsReady = xConnected && scopes.includes('tweet.read') && env.X_INBOUND_SYNC_ENABLED === 'true' && Boolean(env.X_INBOUND_READ_USD?.trim());
  const xDmReady = xConnected && scopes.includes('dm.read') && env.X_DM_READ_ENABLED === 'true' && Boolean(env.X_DM_READ_USD?.trim());
  const igCommentsPoll = probe.readComments === true;
  const igDmReady = probe.readDm === true && env.INSTAGRAM_DM_READ_ENABLED === 'true' && env.INSTAGRAM_DM_READ_USD != null && String(env.INSTAGRAM_DM_READ_USD).trim() !== '';
  const mentionCheckpoint = await loadSyncCheckpoint(env.DB, userId, 'x_mentions');
  const xDmCheckpoint = await loadSyncCheckpoint(env.DB, userId, 'x_dm');
  const igCommentCheckpoint = await loadSyncCheckpoint(env.DB, userId, 'instagram_comments_poll');
  const igDmCheckpoint = await loadSyncCheckpoint(env.DB, userId, 'instagram_dm');
  const checkpointHealth = [mentionCheckpoint, xDmCheckpoint, igCommentCheckpoint, igDmCheckpoint];
  const checkpointQueryFailed = checkpointHealth.some((item) => !item.available);
  const webhookLabel = instagramCommentsWebhookSourceStatus({
    secretsConfigured: webhookSecrets,
    dashboardConfirmed: webhookConfirmed,
    readComments: igCommentsPoll,
  });
  return [
    sourceCheck('xMentions', 'X mentions', xMentionsReady ? 'READY' : (env.X_INBOUND_SYNC_ENABLED === 'true' ? 'BLOCKED' : 'DISABLED'), xMentionsReady
      ? `X mention/reply polling is ready${mentionCheckpoint.available && mentionCheckpoint.checkpoint?.continuationCursor ? ' (continuation cursor stored).' : '.'}`
      : 'X mention sync is not ready.', xMentionsReady ? undefined : 'Set X_INBOUND_SYNC_ENABLED=true, X_INBOUND_READ_USD, and connect X.'),
    sourceCheck('xDm', 'X DM', xDmReady ? 'READY' : (env.X_DM_READ_ENABLED === 'true' ? 'BLOCKED' : 'DISABLED'), xDmReady
      ? 'X DM read is ready.'
      : 'X DM read is not ready.', xDmReady ? undefined : 'Settings → X → DM権限を追加, then X_DM_READ_ENABLED=true and X_DM_READ_USD.'),
    sourceCheck('instagramCommentsWebhook', 'Instagram comments webhook', webhookLabel, webhookLabel === 'WEBHOOK REGISTERED'
      ? 'Comment webhook is the realtime primary. Dashboard registration was confirmed by INSTAGRAM_COMMENT_WEBHOOK_CONFIRMED.'
      : webhookLabel === 'BLOCKED'
        ? 'Webhook dashboard registration is confirmed, but comment permission is not verified. Inbox webhook is not ready.'
        : webhookSecrets
          ? 'Webhook secrets are present, but Meta dashboard registration is UNCONFIRMED. Bounded poll catch-up continues.'
          : 'Comment webhook is not fully ready.', webhookLabel === 'WEBHOOK REGISTERED' ? undefined : webhookLabel === 'BLOCKED' ? 'Complete Meta comment permission, then re-run preflight.' : 'Register comments + live_comments in Meta App Dashboard, then set INSTAGRAM_COMMENT_WEBHOOK_CONFIRMED=true.'),
    sourceCheck('instagramCommentsPoll', 'Instagram comments polling', igCommentsPoll ? 'POLLING READY' : 'BLOCKED', igCommentsPoll
      ? (webhookConfirmed
        ? 'Polling is a bounded catch-up fallback. Webhook dashboard registration is confirmed.'
        : 'Polling fallback covers bounded paginated catch-up of owned media. Webhook secrets are not treated as confirmed registration.')
      : 'Comment polling is blocked until comment permission is verified.', webhookConfirmed ? undefined : 'Confirm comments + live_comments in Meta App Dashboard, then set INSTAGRAM_COMMENT_WEBHOOK_CONFIRMED=true.'),
    sourceCheck('instagramDm', 'Instagram DM', igDmReady ? 'READY' : 'BLOCKED', igDmReady
      ? 'Instagram DM read is ready. Official API details cover the 20 most recent messages per conversation; older message bodies are a Meta limitation. Incomplete threads from our page budget are never marked processed.'
      : 'Instagram DM read is blocked.', 'Verify message permission, set INSTAGRAM_DM_READ_ENABLED=true and INSTAGRAM_DM_READ_USD. Register the messaging webhook for realtime DMs.'),
    sourceCheck('syncCheckpointHealth', 'Sync checkpoint query', checkpointQueryFailed ? 'BLOCKED' : 'READY', checkpointQueryFailed
      ? checkpointHealth.find((item) => !item.available)?.reason || 'Checkpoint query failed.'
      : 'Sync checkpoint table is readable for all sources.', checkpointQueryFailed ? 'Run production D1 migrations and confirm D1 is reachable.' : undefined),
  ];
}

function sourceCheck(id: string, label: string, status: string, reason: string, nextStep?: string) {
  const blocked = status === 'BLOCKED';
  const disabled = status === 'DISABLED';
  const unconfirmed = status === 'UNCONFIRMED';
  const severity: Check['severity'] = blocked || disabled || unconfirmed ? 'warn' : 'ok';
  return {
    id,
    status,
    check: {
      ok: true,
      severity,
      label: `${label}: ${status}`,
      reason,
      nextStep,
    } satisfies Check,
  };
}

export { operationWriteEnabled };
