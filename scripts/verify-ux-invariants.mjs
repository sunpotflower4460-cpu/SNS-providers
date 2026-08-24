import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const daily = await readFile(new URL('../src/DailyQueue.tsx', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/BackupControls.tsx', import.meta.url), 'utf8');
const social = await readFile(new URL('../src/social.ts', import.meta.url), 'utf8');
const dialogBehavior = await readFile(new URL('../src/dialogBehavior.ts', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
const syncControls = await readFile(new URL('../src/SyncControls.tsx', import.meta.url), 'utf8');
const workloadControls = await readFile(new URL('../src/WorkloadControls.tsx', import.meta.url), 'utf8');
const ux = await readFile(new URL('../src/ux.css', import.meta.url), 'utf8');
const devicePolish = await readFile(new URL('../src/devicePolish.css', import.meta.url), 'utf8');
const accessibility = await readFile(new URL('../src/accessibility.css', import.meta.url), 'utf8');
const syncCss = await readFile(new URL('../src/sync.css', import.meta.url), 'utf8');
const workloadCss = await readFile(new URL('../src/workload.css', import.meta.url), 'utf8');
const xAccountCss = await readFile(new URL('../src/xAccount.css', import.meta.url), 'utf8');
const instagramCss = await readFile(new URL('../src/instagramAccount.css', import.meta.url), 'utf8');

function requireAll(source, fragments, message) {
  if (!fragments.every((fragment) => source.includes(fragment))) throw new Error(message);
}

requireAll(app, [
  "label: '今日'",
  "label: '探す'",
  "label: '関係'",
  "label: '自分'",
  "label: '設定'",
  'aria-current={tab === item.id',
], 'Main navigation can regress to mixed-language or lose current-page semantics.');

requireAll(daily, [
  'まず、この1件から',
  '次にやること',
  'next-action-card',
  'next-action-cta',
  'nextActionCta(first.action, firstCandidate)',
  'その次',
], 'Today no longer presents one clear, action-specific next step before secondary queue items.');

requireAll(daily, [
  'activeCandidateCount === 0',
  'まず、つながる候補を見つけましょう',
  'completedToday',
  '今日のおすすめは完了です',
  '今は実行できる候補がありません',
  'onOpenDiscover',
], 'Today empty states can again confuse first use, completed work, and insufficient actionable evidence.');

requireAll(app, [
  "const hasCandidates = state.candidates.some((candidate) => !candidate.skipped);",
  "const queue = hasCandidates ? rawQueue : [];",
  "hasCandidates ? `${doneToday} / ${plannedTotal}` : '準備前'",
], 'First-use progress can again show synthetic self-actions or a misleading completed state before any candidate exists.');

requireAll(app, [
  'Missionから自動で探す',
  '<details className="disclosure-card">',
  '自分で候補を追加',
  '候補情報を更新・再評価',
], 'Discover can regress to exposing primary and advanced actions at the same visual level.');

requireAll(app, [
  'const [visibleLimit, setVisibleLimit] = useState(12);',
  'const displayed = visible.slice(0, visibleLimit);',
  '次の{Math.min(12, hiddenCount)}人を見る',
  'aria-pressed={filter === item}',
], 'Discover can regress to rendering the full candidate pool at once or lose accessible filter selection state.');

requireAll(app, [
  'おすすめ理由',
  '<details className="candidate-details">',
  '判断材料を見る',
  'candidateActionButtonLabel',
], 'Candidate cards can regress to showing all AI detail at once or use ambiguous action buttons.');

requireAll(app, [
  "case 'follow': return { label: 'フォローした', result: 'followed' }",
  "case 'like': return { label: 'いいねした', result: 'kept' }",
  "case 'reply': return { label: '返信した', result: 'kept' }",
  "case 'dm': return { label: 'DMした', result: 'kept' }",
  'role="dialog" aria-modal="true"',
], 'Result recording can regress to ambiguous outcome choices or lose dialog semantics.');

requireAll(dialogBehavior, [
  "event.key === 'Escape'",
  "event.key !== 'Tab'",
  "dialog.querySelector<HTMLButtonElement>('.sheet-actions .sheet-primary')",
  'previous?.isConnected',
], 'Result dialog can regress to missing Escape close, focus trapping, initial focus, or focus restoration.');
requireAll(main, ['installDialogBehavior();'], 'Result dialog keyboard behavior is no longer installed at app startup.');

requireAll(social, [
  "candidate.recommendedAction === 'reply' || candidate.recommendedAction === 'like'",
  'safeEngagementUrl(candidate.platform, candidate.engagementUrl)',
  "'コピーしました'",
  "'コピーできませんでした'",
  'button.dataset.copyState = state',
], 'Exact actionable handoff or visible clipboard success/failure feedback regressed.');

requireAll(app, [
  "const cleanupPriority = Number(b.recommendedAction === 'unfollow_review')",
  "aria-label={`${candidate.username} のフォローバック状態`}",
  'aria-pressed={candidate.followBack === true}',
], 'Relations can regress to hiding cleanup urgency or lose accessible follow-back selection state.');

requireAll(app, [
  "profile: 'プロフィール'",
  "content: '投稿'",
  "network: 'つながり'",
  'insightCategoryLabel[insight.category]',
], 'Self-analysis category labels can regress to internal English taxonomy.');

requireAll(app, [
  'const [saved, setSaved] = useState(false);',
  "{saved ? '保存しました' : 'この設定を保存'}",
  'aria-live="polite"',
], 'Settings can regress to giving no explicit save confirmation.');

requireAll(app, [
  'const freeOnly = state.budget.monthlyLimitUsd === 0;',
  'const hasSpend = state.budget.usedUsd > 0.00001;',
  '有料処理OFF',
], 'Budget pill can again claim free operation while existing paid spend is present.');

requireAll(backup, [
  '<details className="settings-group">',
  '1日の量を調整',
  'アプリ・SNS・クラウド接続',
  'バックアップ',
], 'Advanced settings can regress to an always-expanded wall of controls.');

requireAll(workloadControls, [
  'まずは合計だけ決めればOKです',
  'おすすめの判断材料を見る',
  '<details className="workload-breakdown">',
  '内訳を細かく調整',
  '候補が減ったら自動で補う',
], 'Workload settings can regress to exposing recommendation internals and every category slider at once.');

requireAll(syncControls, [
  'const [showToken, setShowToken] = useState(false);',
  "type={showToken ? 'text' : 'password'}",
  "aria-label={showToken ? '個人管理キーを隠す' : '個人管理キーを表示'}",
  'aria-live="polite"',
], 'Cloud-sync key entry can regress to unverifiable masked input or silent operation status.');

requireAll(ux, [
  '.primary-button,',
  'min-height: 48px;',
  '.nav-item {',
  'min-height: 52px;',
  '.settings-group',
  '.candidate-details',
], 'Clarity/touch-target styling can regress below the intended hierarchy.');

requireAll(devicePolish, [
  '.status-line i',
  'overflow-wrap: anywhere;',
  '.insight-card > div:last-child > span',
  '.load-more-button',
  'button[data-copy-state="success"]',
  'button[data-copy-state="error"]',
  'max-height: min(88dvh, 720px);',
  'overscroll-behavior: contain;',
  '@media (orientation: landscape) and (max-height: 600px)',
], 'Real-device overflow, progressive reveal, copy feedback styling, result-sheet safety, neutral status semantics, or Japanese insight presentation regressed.');

requireAll(syncCss, [
  '.secret-field',
  '.secret-field button[aria-pressed="true"]',
  '.sync-footer small',
  'font-size: 10px;',
  '@media (max-width: 520px)',
  '.sync-actions { grid-template-columns: 1fr; }',
], 'Cloud-sync details can regress to hidden-input friction, tiny text, or cramped two-column phone actions.');

requireAll(workloadCss, [
  '.workload-details',
  '.workload-breakdown',
  '.workload-breakdown-body',
  '.auto-replenish-toggle input { width: 22px; height: 22px;',
  '.workload-warning',
], 'Advanced workload controls can regress to an undifferentiated wall of controls or undersized toggles.');

requireAll(accessibility, [
  'scroll-margin-block: 110px;',
  '@media (max-width: 640px)',
  'font-size: 16px !important;',
  'input[type="range"]::-webkit-slider-thumb',
  'width: 28px;',
  '@media (prefers-reduced-motion: reduce)',
  '@media (prefers-contrast: more)',
  '@media (forced-colors: active)',
], 'Mobile keyboard ergonomics, slider touch size, reduced motion, or contrast accessibility regressed.');

for (const [name, source] of [
  ['sync', syncCss],
  ['workload', workloadCss],
  ['X connection', xAccountCss],
  ['Instagram connection', instagramCss],
]) {
  if (source.includes('font-size: 7px') || source.includes('font-size: 8px')) {
    throw new Error(`${name} advanced settings regressed to unreadably small 7–8px text.`);
  }
}

console.log('UX invariants OK: Japanese navigation, truthful Today states, action-specific next steps, progressive candidate reveal, accessible selection states, action-specific outcomes, keyboard-safe dialogs, clipboard feedback, urgent relation ordering, save feedback, truthful budget display, progressive workload tuning, verifiable sync-key entry, mobile input ergonomics, readable advanced settings, and real-device viewport safety are preserved.');
