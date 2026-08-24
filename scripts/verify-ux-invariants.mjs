import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
const daily = await readFile(new URL('../src/DailyQueue.tsx', import.meta.url), 'utf8');
const backup = await readFile(new URL('../src/BackupControls.tsx', import.meta.url), 'utf8');
const social = await readFile(new URL('../src/social.ts', import.meta.url), 'utf8');
const ux = await readFile(new URL('../src/ux.css', import.meta.url), 'utf8');

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
  '上から順に進めればOK',
  'next-action-card',
  'next-action-cta',
  'その次',
], 'Today no longer presents one clear next action before secondary queue items.');

requireAll(app, [
  'Missionから自動で探す',
  '<details className="disclosure-card">',
  '自分で候補を追加',
  '候補情報を更新・再評価',
], 'Discover can regress to exposing primary and advanced actions at the same visual level.');

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

requireAll(backup, [
  '<details className="settings-group">',
  '1日の量を調整',
  'アプリ・SNS・クラウド接続',
  'バックアップ',
], 'Advanced settings can regress to an always-expanded wall of controls.');

requireAll(social, [
  "candidate.recommendedAction === 'reply' || candidate.recommendedAction === 'like'",
  'safeEngagementUrl(candidate.platform, candidate.engagementUrl)',
], 'Actionable like/reply UI can claim a concrete target while opening only a generic profile.');

requireAll(ux, [
  '.primary-button,',
  'min-height: 48px;',
  '.nav-item {',
  'min-height: 52px;',
  '.settings-group',
  '.candidate-details',
], 'Clarity/touch-target styling can regress below the intended hierarchy.');

console.log('UX invariants OK: Japanese primary navigation, one-next-action Today flow, progressive disclosure, action-specific outcomes, advanced-settings grouping, exact actionable handoff, and touch-target hierarchy are preserved.');
