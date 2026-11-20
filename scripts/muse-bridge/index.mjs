import { createHash } from 'node:crypto';

const usage = `Usage: node scripts/muse-bridge/index.mjs <command>
  preflight
  today
  show <id>
  execute <id> [--confirm <confirmation>]
  budget`;

const hashPattern = /^[a-f0-9]{64}$/;
const [command, id, flag, confirmation, ...extra] = process.argv.slice(2);
const syncToken = process.env.SNSP_SYNC_TOKEN?.trim() || '';

try {
  if (command === '--help' && id === undefined) {
    console.log(usage);
  } else {
    validateCommand();
    await run(readWorkerOrigin());
  }
} catch (error) {
  console.error(redact(error.message));
  process.exitCode = 1;
}

function validateCommand() {
  if (['preflight', 'today', 'budget'].includes(command) && id === undefined) return;
  const validId = typeof id === 'string' && id.length <= 180 && id.trim() === id
    && !id.startsWith('-') && !/[\u0000-\u001f\u007f]/.test(id) && id !== '' && id !== '.' && id !== '..';
  if (validId && command === 'show' && flag === undefined) return;
  if (validId && command === 'execute' && (flag === undefined
    || (flag === '--confirm' && hashPattern.test(confirmation) && extra.length === 0))) return;
  throw new Error(usage);
}

function readWorkerOrigin() {
  if (!syncToken || syncToken.length > 512) throw new Error('Set SNSP_SYNC_TOKEN in the runtime environment.');
  let url;
  try {
    url = new URL(process.env.SNSP_API_BASE_URL || '');
  } catch {
    throw new Error('Set SNSP_API_BASE_URL to the Worker origin.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SNSP_API_BASE_URL must be an HTTPS origin, or a loopback HTTP origin for local checks.');
  }
  return url.origin;
}

async function request(origin, path, payload) {
  const headers = { accept: 'application/json', authorization: `Bearer ${syncToken}` };
  if (payload) headers['content-type'] = 'application/json';
  const response = await fetch(origin + path, {
    method: payload ? 'POST' : 'GET',
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(payload ? 60_000 : 30_000),
  }).catch(() => {
    throw new Error('Worker request failed (connection, timeout, or redirect).');
  });
  const body = await response.json().catch(() => null);
  if (!record(body)) throw new Error(`Worker returned an invalid response (HTTP ${response.status}).`);
  return { status: response.status, body };
}

async function read(origin, path) {
  const { status, body } = await request(origin, path);
  if (status !== 200) throw new Error(`Worker read failed (HTTP ${status}).`);
  return body;
}

async function snapshot(origin) {
  const result = await read(origin, '/api/sync/state');
  if (result.found === false && result.state === null) return { state: {}, updatedAt: null };
  if (result.found !== true || !record(result.state) || typeof result.updatedAt !== 'string') {
    throw new Error('Worker returned an invalid D1 snapshot.');
  }
  return result;
}

async function run(origin) {
  switch (command) {
    case 'preflight':
      print(await read(origin, '/api/preflight'));
      break;
    case 'budget':
      print(await budget(origin));
      break;
    case 'today':
      print(await today(origin));
      break;
    case 'show':
      print(id.startsWith('candidate:') ? await showCandidate(origin, id) : await reviewAction(origin, id));
      break;
    case 'execute':
      await execute(origin);
      break;
  }
}

async function budget(origin) {
  const [usage, settings] = await Promise.all([
    read(origin, '/api/budget'),
    read(origin, '/api/settings/runtime'),
  ]);
  if (![usage.usedUsd, usage.limitUsd, settings.effectiveLimitUsd].every(isAmount)
    || typeof usage.ledgerAvailable !== 'boolean') {
    throw new Error('Worker returned invalid budget data.');
  }
  const effectiveLimitUsd = Math.min(usage.limitUsd, settings.effectiveLimitUsd);
  return {
    effectiveLimitUsd,
    usedUsd: usage.ledgerAvailable ? usage.usedUsd : null,
    remainingUsd: usage.ledgerAvailable ? Math.max(0, effectiveLimitUsd - usage.usedUsd) : null,
    ledgerAvailable: usage.ledgerAvailable,
  };
}

async function today(origin) {
  const [inbox, { state, updatedAt }] = await Promise.all([
    read(origin, '/api/social/actions'),
    snapshot(origin),
  ]);
  if (inbox.ok !== true || !Array.isArray(inbox.actions)) {
    throw new Error('The canonical Inbox is unavailable.');
  }
  const now = Date.now();
  const inboxStatuses = new Set(['pending', 'ready', 'failed', 'executing']);
  return {
    snapshotUpdatedAt: updatedAt,
    actions: inbox.actions.filter((action) => record(action) && (
      inboxStatuses.has(action.status)
      || (action.status === 'snoozed' && Date.parse(action.snoozedUntil) <= now)
    )).map(({ id, platform, type, status, username, targetUrl, externalEventId }) => ({
      id, platform, type, status, username, targetUrl,
      hasSavedDraft: Boolean(draftText(findSavedAction(state, { id, platform, type, externalEventId }))),
    })),
    candidates: records(state.candidates)
      .filter((candidate) => typeof candidate.id === 'string' && candidate.id && !candidate.skipped
        && !(Date.parse(candidate.snoozedUntil) > now))
      .map(candidateSummary),
  };
}

function candidateSummary(candidate) {
  return {
    id: `candidate:${candidate.id}`,
    platform: candidate.platform,
    username: candidate.username,
    operation: candidate.recommendedAction,
    targetUrl: candidate.engagementUrl || candidate.profileUrl,
    mode: 'handoff',
  };
}

async function showCandidate(origin, candidateId) {
  const { state, updatedAt } = await snapshot(origin);
  const matches = records(state.candidates).filter((candidate) => candidate.id === candidateId.slice('candidate:'.length));
  if (matches.length !== 1) throw new Error('Candidate is missing or ambiguous in the D1 snapshot.');
  return { ...candidateSummary(matches[0]), draft: draftText(matches[0]), snapshotUpdatedAt: updatedAt };
}

async function reviewAction(origin, actionId) {
  const [payload, { state, updatedAt }] = await Promise.all([
    read(origin, `/api/social/actions/${encodeURIComponent(actionId)}/preview`),
    snapshot(origin),
  ]);
  const { action, review, lastExecution } = payload;
  if (payload.ok !== true || !record(action) || action.id !== actionId || !record(review)) {
    throw new Error('Worker returned an invalid action preview.');
  }
  const saved = findSavedAction(state, action);
  const draft = draftText(saved);
  let blockedReason = review.ready === false ? review.reason : null;
  if (review.ready === true) {
    if (!record(review.recipient) || !review.recipient.id || !record(review.target) || !review.target.operation
      || !isAmount(review.costUsd) || !hashPattern.test(review.binding)
      || !Number.isInteger(review.maxDraftLength) || review.maxDraftLength < 1) {
      throw new Error('Worker returned an incomplete target or price.');
    }
    if (!draft) blockedReason = 'Save the draft in the PWA and push the latest snapshot to D1.';
    else if (draft.length > review.maxDraftLength) blockedReason = 'The saved draft is over the provider text limit.';
    else if (saved.unknownExecution || ['completed', 'dismissed', 'executing', 'expired'].includes(saved.status)) {
      blockedReason = 'The saved Inbox marks this action as closed or awaiting a result.';
    }
  }
  return { action, draft, snapshotUpdatedAt: updatedAt, review, blockedReason, lastExecution };
}

async function execute(origin) {
  if (id.startsWith('candidate:')) throw new Error('Candidate suggestions open in the official app.');
  const preview = await reviewAction(origin, id);
  const { action, draft, review, blockedReason } = preview;
  const code = review.ready === true && !blockedReason
    ? createHash('sha256').update(JSON.stringify([review.binding, draft])).digest('hex')
    : null;
  const approvedItem = {
    actionId: action.id,
    platform: action.platform,
    operation: review.target?.operation || action.type,
    recipient: review.recipient || { username: action.username },
    target: review.target || { targetUrl: action.targetUrl },
    draft,
    costUsd: review.costUsd ?? null,
    testMode: review.testMode ?? false,
    status: action.status,
    blockedReason,
    confirmation: code,
  };
  if (flag === undefined) {
    print(approvedItem);
    return;
  }
  if (!code || code !== confirmation) {
    throw new Error('Approval is missing or the preview changed. Present a new execute preview before asking for approval.');
  }
  const executionId = `muse-${code}`;
  console.error(format({ ...approvedItem, executionId }));
  let outcome;
  try {
    outcome = await request(origin, `/api/social/actions/${encodeURIComponent(id)}/execute`, {
      executionId,
      draft,
      museApproval: code,
    });
  } catch {
    return unknownResult(executionId);
  }
  const { body, status } = outcome;
  if (status >= 500 || body.certainty === 'unknown' || body.code === 'UNKNOWN_RESULT') {
    return unknownResult(executionId);
  }
  if (status === 200 && body.ok === true && body.executionId === executionId && body.status === 'succeeded') {
    print({ ok: true, executionId, status: body.status, externalResultId: body.externalResultId ?? null });
  } else if (body.ok === false || body.status === 'failed') {
    print({ ok: false, executionId, status: 'rejected', httpStatus: status, code: body.code ?? null });
    process.exitCode = 1;
  } else {
    unknownResult(executionId);
  }
}

function unknownResult(executionId) {
  print({ ok: false, executionId, status: 'unknown', next: `show ${id}` });
  process.exitCode = 1;
}

function findSavedAction(state, action) {
  if (!action.externalEventId) return null;
  const matches = records(state.socialActions).filter((item) => item.id === action.id
    && item.platform === action.platform && item.type === action.type
    && item.externalEventId === action.externalEventId);
  return matches.length === 1 ? matches[0] : null;
}

function draftText(item) {
  const text = item?.draft ?? item?.aiDraft;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function records(value) {
  return Array.isArray(value) ? value.filter(record) : [];
}

function isAmount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function print(value) {
  console.log(format(value));
}

function format(value) {
  return JSON.stringify(value, (_, field) => typeof field === 'string' ? redact(field) : field, 2);
}

function redact(value) {
  return syncToken ? value.replaceAll(syncToken, '[REDACTED]') : value;
}
