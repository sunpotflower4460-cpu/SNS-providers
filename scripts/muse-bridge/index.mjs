import { createHash } from 'node:crypto';

const usage = `Usage: node scripts/muse-bridge/index.mjs <command> [--json]
  preflight
  today
  candidates
  show <id>
  execute <id> [--draft <text>] [--confirm <confirmation>]
  budget
  refresh
  regenerate <candidate:id>
  record <candidate:id> --completed | --skipped`;

const hashPattern = /^[a-f0-9]{64}$/;
const candidatePrefix = 'candidate:';
const syncToken = process.env.SNSP_SYNC_TOKEN?.trim() || '';
const operations = { follow: 'フォロー', like: 'いいね', reply: '返信', review: '確認' };
const statuses = { pending: '未対応', ready: '未対応', executing: '結果確認中', completed: '完了', skipped: '見送り', dismissed: '見送り', failed: '前回失敗' };
const refreshStatuses = { ok: '完了', cached: '直近の取得結果', partial: '途中まで取得', error: '取得エラー', unavailable: '利用不可', skipped: '省略' };
let outputJson = false;

try {
  const options = parseCommand(process.argv.slice(2));
  if (options.command === '--help') console.log(usage);
  else {
    outputJson = options.json;
    await run(readWorkerOrigin(), options);
  }
} catch (error) {
  const message = redact(error instanceof Error ? error.message : 'Muse Bridge failed.');
  console.error(outputJson ? JSON.stringify({ ok: false, error: message }) : message);
  process.exitCode = 1;
}

function parseCommand(args) {
  const [command, ...rest] = args;
  if (command === '--help' && !rest.length) return { command };
  const options = { command, json: false };
  const optionsWithValue = { '--confirm': 'confirmation', '--draft': 'draft' };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    if (arg === '--json' && !options.json) options.json = true;
    else if (['--completed', '--skipped'].includes(arg) && !options.outcome) options.outcome = arg.slice(2);
    else if (Object.hasOwn(optionsWithValue, arg) && options[optionsWithValue[arg]] === undefined && index + 1 < rest.length) {
      options[optionsWithValue[arg]] = rest[++index];
    } else if (!options.id && /^[A-Za-z0-9._:-]{1,180}$/.test(arg) && !arg.startsWith('-') && arg !== '.' && arg !== '..') {
      options.id = arg;
    } else throw new Error(usage);
  }
  const { id, outcome, draft, confirmation } = options;
  const candidate = id?.startsWith(candidatePrefix);
  if (['preflight', 'today', 'candidates', 'budget', 'refresh'].includes(command)
    && !id && !outcome && draft === undefined && confirmation === undefined) return options;
  if (command === 'show' && id && !outcome && draft === undefined && confirmation === undefined) return options;
  if (command === 'regenerate' && candidate && !outcome && draft === undefined && confirmation === undefined) return options;
  if (command === 'record' && candidate && outcome && draft === undefined && confirmation === undefined) return options;
  if (command === 'execute' && id && !outcome && (confirmation === undefined || hashPattern.test(confirmation))) return options;
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

async function request(origin, path, payload, timeout = payload ? 60_000 : 30_000) {
  const headers = { accept: 'application/json', authorization: `Bearer ${syncToken}` };
  if (payload) headers['content-type'] = 'application/json';
  const response = await fetch(origin + path, {
    method: payload ? 'POST' : 'GET',
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(timeout),
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

async function prepare(origin, path, payload, timeout) {
  const { status, body } = await request(origin, path, payload, timeout);
  if (status !== 200 || body.ok !== true) throw new Error(`Muse preparation failed (HTTP ${status}).`);
  return body;
}

async function run(origin, options) {
  const { command, id, outcome } = options;
  switch (command) {
    case 'preflight':
      print(await read(origin, '/api/preflight'), preflightText);
      break;
    case 'budget':
      print(await budget(origin), budgetText);
      break;
    case 'today':
      print(await read(origin, '/api/muse/today'), todayText);
      break;
    case 'candidates':
      print(await read(origin, '/api/muse/candidates'), ({ candidates }) => candidateList(candidates));
      break;
    case 'show':
      if (id.startsWith(candidatePrefix)) {
        print(await read(origin, candidatePath(id)), ({ candidate }) => candidateText(candidate));
      } else {
        print(await reviewAction(origin, id), ({ action, draft, blockedReason, lastExecution }) => [
          replyText({ ...action, draft }), blockedReason, lastExecution && executionText(lastExecution),
        ].filter(Boolean).join('\n'));
      }
      break;
    case 'refresh': {
      const intake = await prepare(origin, '/api/muse/refresh', { phase: 'intake' }, 180_000);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(intake.dateJst)) throw new Error('Worker returned an invalid refresh date.');
      print(await prepare(origin, '/api/muse/refresh', { phase: 'prepare', dateJst: intake.dateJst }, 180_000), todayText);
      break;
    }
    case 'regenerate':
      print(await prepare(origin, `${candidatePath(id)}/draft`, {}), ({ candidate }) => candidateText(candidate));
      break;
    case 'record':
      print(await prepare(origin, `${candidatePath(id)}/record`, { outcome }),
        ({ id: candidateId, status }) => `${candidateId} ${status === 'completed' ? '実施済み' : '見送り'}を記録しました。`);
      break;
    case 'execute':
      await execute(origin, options);
      break;
  }
}

function candidatePath(id) {
  return `/api/muse/candidates/${encodeURIComponent(id)}`;
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

async function reviewAction(origin, actionId, editedDraft) {
  const [preview, details] = await Promise.all([
    read(origin, `/api/social/actions/${encodeURIComponent(actionId)}/preview`),
    read(origin, `/api/muse/replies/${encodeURIComponent(actionId)}`),
  ]);
  const { action, review, lastExecution } = preview;
  const item = details.action;
  if (preview.ok !== true || details.ok !== true || !record(action) || !record(item) || !record(review)
    || action.id !== actionId || item.id !== actionId || action.platform !== 'x' || action.type !== 'reply_inbound'
    || !action.externalEventId || item.externalEventId !== action.externalEventId || action.status !== item.status) {
    throw new Error('The X reply changed or is unavailable. Read it again before approval.');
  }
  const draft = editedDraft === undefined ? item.draft : editedDraft.trim();
  let blockedReason = review.ready === false ? review.reason : null;
  if (review.ready === true) {
    if (!record(review.recipient) || review.recipient.id !== item.recipientId || !record(review.target)
      || review.target.operation !== 'x_reply_write' || review.target.externalEventId !== item.externalEventId
      || !isAmount(review.costUsd) || !hashPattern.test(review.binding) || !Number.isInteger(review.maxDraftLength)
      || review.maxDraftLength < 1) {
      throw new Error('Worker returned an incomplete target or price.');
    }
    if (item.suppressed) blockedReason = '見送り済み、対応済み、または結果確認中の返信です。';
    else if (!draft) blockedReason = '文案を用意してから承認してください。';
    else if (draft.length > review.maxDraftLength) blockedReason = '本文が文字数の上限を超えています。';
    else if (draft.includes(syncToken)) blockedReason = '本文に個人管理キーが含まれています。';
    else if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|jp|io|co|me|ly|gl|app|dev|link)\b/i.test(draft)) {
      blockedReason = '送信する返信本文からURLを取り除いてください。';
    }
  }
  return { action: item, draft, review, blockedReason, lastExecution };
}

async function execute(origin, { id, draft: editedDraft, confirmation }) {
  if (id.startsWith(candidatePrefix)) throw new Error('Candidate suggestions open in the official app.');
  const { action, draft, review, blockedReason } = await reviewAction(origin, id, editedDraft);
  const code = review.ready === true && !blockedReason
    ? createHash('sha256').update(JSON.stringify([review.binding, draft])).digest('hex') : null;
  const item = {
    actionId: action.id, platform: action.platform, operation: 'x_reply_write',
    recipient: review.recipient || { id: action.recipientId, username: action.username },
    target: { externalEventId: action.externalEventId, targetUrl: action.targetUrl },
    draft, costUsd: review.costUsd ?? null, testMode: review.testMode ?? false,
    status: action.status, blockedReason, confirmation: code,
  };
  if (confirmation === undefined) {
    print(item, approvalText);
    return;
  }
  if (!code || code !== confirmation) {
    throw new Error('Approval is missing or the preview changed. Present a new execute preview before asking for approval.');
  }
  const executionId = `muse-${code}`;
  console.error(outputJson ? json({ ...item, executionId }) : redact(approvalText(item)));
  let outcome;
  try {
    outcome = await request(origin, `/api/social/actions/${encodeURIComponent(id)}/execute`, { executionId, draft, museApproval: code });
  } catch {
    return unknownResult(id, executionId);
  }
  const { body, status } = outcome;
  if (status >= 500 || body.certainty === 'unknown' || body.code === 'UNKNOWN_RESULT') {
    return unknownResult(id, executionId);
  }
  if (status === 200 && body.ok === true && body.executionId === executionId && body.status === 'succeeded') {
    print({ ok: true, executionId, status: body.status, externalResultId: body.externalResultId ?? null }, executionText);
  } else if (body.ok === false || body.status === 'failed') {
    print({ ok: false, executionId, status: 'rejected', httpStatus: status, code: body.code ?? null }, executionText);
    process.exitCode = 1;
  } else {
    unknownResult(id, executionId);
  }
}

function unknownResult(id, executionId) {
  print({ ok: false, executionId, status: 'unknown', next: `show ${id}` }, executionText);
  process.exitCode = 1;
}

function todayText({ actions, candidates, target, candidateReserve, refresh, alreadyStarted }) {
  if (!Array.isArray(actions) || !Array.isArray(candidates)) throw new Error('Worker returned an invalid evening list.');
  return [
    `今夜の交流 ${actions.length + candidates.length}件（目安 ${target}件、候補の在庫 ${candidateReserve}件）`,
    refresh ? `準備 ${refresh.dateJst}（日本時間） ${refresh.finishedAt
      ? `メンション ${refreshStatuses[refresh.mentions] || '未確認'} ／ 候補探し ${refreshStatuses[refresh.discovery] || '未確認'}` : '開始済み。保存されている項目を表示しています。'}`
      : '準備の記録はまだありません。',
    alreadyStarted && '今日の準備はすでに開始しています。',
    actions.length && ['**届いた返信とメンション**', ...actions.map(replyText)].join('\n\n'),
    candidates.length && ['**交流の候補**', candidateList(candidates)].join('\n\n'),
  ].filter(Boolean).join('\n\n');
}

function candidateList(candidates) {
  return candidates.length ? candidates.map(candidateText).join('\n\n') : '表示できる候補はありません。';
}

function candidateText(item) {
  return [
    `**${item.rank ? `${item.rank}. ` : ''}${operations[item.operation] || '確認'} · @${item.username}** （${statuses[item.status] || item.status}）`,
    item.targetUrl, item.postUrl && item.postUrl !== item.targetUrl && `投稿 ${item.postUrl}`,
    item.profileSummary && quote(item.profileSummary),
    item.reason && `おすすめの理由\n${quote(item.reason)}`,
    item.draft && `挨拶の文案\n${copyable(item.draft)}`,
    `ID ${item.id}`,
  ].filter(Boolean).join('\n');
}

function replyText(item) {
  return [
    `**返信 · ${item.username ? `@${item.username}` : `Xユーザー ${item.recipientId || ''}`}** （${statuses[item.status] || item.status}）`,
    item.targetUrl, item.inboundText && `届いた内容\n${quote(item.inboundText)}`,
    item.draft ? `返信の文案\n${copyable(item.draft)}` : '返信の文案はまだありません。',
    `ID ${item.id}`,
  ].filter(Boolean).join('\n');
}

function approvalText(item) {
  return [
    `承認内容 · Xで返信 · ${item.recipient.username ? `@${item.recipient.username}` : item.recipient.id}`, item.target.targetUrl,
    `料金 ${item.costUsd === null ? '未確認' : dollars(item.costUsd)}`, item.testMode && 'テストモード',
    item.draft && copyable(item.draft), item.blockedReason,
    item.confirmation && `確認番号 ${item.confirmation}`,
  ].filter(Boolean).join('\n');
}

function preflightText(data) {
  const schema = data.database;
  return [
    schema && `D1 スキーマ ${schema.migrationVersion ?? '未確認'} / ${schema.expectedMigrationVersion}`,
    data.inboxSources?.xMentions && `Xのメンション読み取り ${data.inboxSources.xMentions.status}`,
    `Xの返信権限 ${data.x?.replyReady ? '準備済み' : '未確認または準備待ち'}`,
    `無料AI ${data.ai?.groqFree || data.ai?.sakura ? '利用可' : '未確認または準備待ち'}`,
    `候補探し ${data.ai?.discovery ? '利用可' : '未確認または準備待ち'}`,
  ].filter(Boolean).join('\n');
}

function budgetText({ effectiveLimitUsd, usedUsd, remainingUsd }) {
  return `月の上限 ${dollars(effectiveLimitUsd)} ／ 使用額 ${dollars(usedUsd)} ／ 残り ${dollars(remainingUsd)}`;
}

function executionText({ executionId, status, externalResultId, code, next }) {
  const result = { succeeded: '送信完了', pending: '結果確認中', failed: '失敗', rejected: '送信できませんでした', unknown: '送信結果を確認中' };
  return [result[status] || status, code, `実行ID ${executionId}`, externalResultId && `投稿ID ${externalResultId}`, next && `状態の確認 ${next}`]
    .filter(Boolean).join('\n');
}

function quote(value) {
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}

function copyable(value) {
  const length = Math.max(2, ...(value.match(/`+/g) || []).map((run) => run.length)) + 1;
  const fence = '`'.repeat(length);
  return `${fence}\n${value}\n${fence}`;
}

function dollars(value) { return value === null ? '未確認' : `$${value.toFixed(4)}`; }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isAmount(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function print(value, render) { console.log(outputJson ? json(value) : redact(render(value))); }
function json(value) { return JSON.stringify(value, (_, field) => typeof field === 'string' ? redact(field) : field, 2); }
function redact(value) { return syncToken ? value.replaceAll(syncToken, '[REDACTED]') : value; }
