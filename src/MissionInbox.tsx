import { useEffect, useMemo, useState } from 'react';
import DailyQueue from './DailyQueue';
import { buildMissionInbox, inboxSummary, type MissionInboxItem } from './missionInbox';
import { copyDraft, platformLabel } from './social';
import { dismissInboxAction, snoozeInboxAction, updateSocialActionDraft } from './store';
import type { AppState, AppStateUpdater, Candidate, SocialAction } from './types';
import { useLocalDayKey } from './useLocalDay';
import './daily.css';
import './missionInbox.css';

interface Props {
  state: AppState;
  onChange: AppStateUpdater;
  onOpenCandidate: (candidate: Candidate, action?: SocialAction) => void;
  onOpenMe: () => void;
  onOpenDiscover: () => void;
}

const categoryLabel: Record<MissionInboxItem['category'], string> = {
  reply: '返す',
  outreach: '会いに行く',
  connect: 'つながる',
  nurture: '育てる',
  cleanup: '整える',
};

const typeLabel: Record<SocialAction['type'], string> = {
  reply_inbound: '返信',
  reply_outbound: '話しかける',
  comment_reply: 'コメント返信',
  dm_reply: 'DM返信',
  dm_outbound: 'DM',
  follow: 'フォロー',
  like: 'いいね',
  reconnect: '再交流',
  relationship_review: '関係の確認',
  unfollow_review: 'フォロー整理',
};

export default function MissionInbox({ state, onChange, onOpenCandidate, onOpenMe, onOpenDiscover }: Props) {
  const localDay = useLocalDayKey();
  const items = useMemo(() => buildMissionInbox(state), [state, localDay]);
  const socialItems = items.filter((item) => item.kind === 'social');

  if (socialItems.length === 0) {
    return <DailyQueue state={state} onOpenCandidate={onOpenCandidate} onOpenMe={onOpenMe} onOpenDiscover={onOpenDiscover} />;
  }

  const summary = inboxSummary(items);
  const first = socialItems[0];
  const remaining = items.filter((item) => item.id !== first.id).slice(0, 8);

  return <section className="daily-queue mission-inbox">
    <div className="daily-queue-head">
      <div>
        <span className="section-kicker">Mission Inbox</span>
        <h2>今、向き合う交流</h2>
      </div>
      <span className="queue-count">残り {items.length}件</span>
    </div>
    <div className="inbox-summary" aria-label="今日の交流内訳">
      <span><b>{summary.reply}</b>返す</span>
      <span><b>{summary.outreach}</b>会いに行く</span>
      <span><b>{summary.connect}</b>つながる</span>
      <span><b>{summary.cleanup}</b>整える</span>
    </div>
    {first.action && first.candidate && (
      <SocialActionCard
        featured
        action={first.action}
        candidate={first.candidate}
        onOpen={onOpenCandidate}
        onSnooze={(actionId) => onChange((current) => snoozeInboxAction(current, actionId))}
        onDismiss={(actionId) => onChange((current) => dismissInboxAction(current, actionId))}
        onEditDraft={(actionId, draft) => onChange((current) => updateSocialActionDraft(current, actionId, draft))}
      />
    )}
    {remaining.length > 0 && <div className="queue-list-block">
      <div className="queue-list-label"><span>その次</span><small>1件終えると自動で繰り上がります</small></div>
      <div className="queue-list">
        {remaining.map((item, index) => {
          if (item.kind === 'social' && item.action && item.candidate) {
            return <button
              key={item.id}
              className={item.category === 'cleanup' ? 'queue-row cleanup' : 'queue-row'}
              onClick={() => onOpenCandidate(item.candidate!, item.action)}
            >
              <span className="queue-rank">{index + 2}</span>
              <span className="queue-action-icon">{item.action.platform === 'x' ? 'X' : '◎'}</span>
              <span className="queue-copy">
                <small>{categoryLabel[item.category]} · {typeLabel[item.action.type]}</small>
                <strong>{item.candidate.displayName || `@${item.candidate.username}`}</strong>
              </span>
              <span className="queue-arrow">›</span>
            </button>;
          }
          const queue = item.queueItem;
          if (!queue) return null;
          return <button
            key={item.id}
            className={queue.action === 'unfollow_review' ? 'queue-row cleanup' : 'queue-row'}
            onClick={() => {
              if (queue.kind === 'self') onOpenMe();
              else if (item.candidate) onOpenCandidate(item.candidate);
              else onOpenDiscover();
            }}
          >
            <span className="queue-rank">{index + 2}</span>
            <span className="queue-action-icon">{queue.kind === 'self' ? '✦' : '◎'}</span>
            <span className="queue-copy">
              <small>{categoryLabel[item.category]}</small>
              <strong>{queue.title}</strong>
            </span>
            <span className="queue-arrow">›</span>
          </button>;
        })}
      </div>
    </div>}
    {items.length > 9 && <p className="queue-more">まず上位だけ表示しています。完了すると次の候補が自動で繰り上がります。</p>}
  </section>;
}

function SocialActionCard({
  action,
  candidate,
  featured,
  onOpen,
  onSnooze,
  onDismiss,
  onEditDraft,
}: {
  action: SocialAction;
  candidate: Candidate;
  featured?: boolean;
  onOpen: (candidate: Candidate, action?: SocialAction) => void;
  onSnooze: (actionId: string) => void;
  onDismiss: (actionId: string) => void;
  onEditDraft: (actionId: string, draft: string) => void;
}) {
  const [draftText, setDraftText] = useState(action.draft ?? action.aiDraft ?? '');
  useEffect(() => setDraftText(action.draft ?? action.aiDraft ?? ''), [action.draft, action.aiDraft]);
  const showDraft = action.type === 'comment_reply'
    || action.type === 'reply_inbound'
    || action.type === 'reply_outbound'
    || action.type === 'dm_reply'
    || action.type === 'dm_outbound';
  const age = formatAge(action.observedAt || action.createdAt);
  const cta = action.executionMode === 'in_app'
    ? `${platformLabel(action.platform)}で返信する`
    : `${platformLabel(action.platform)}で開く`;

  return <article className={featured ? 'inbox-action-card featured' : 'inbox-action-card'}>
    <div className="inbox-action-meta">
      <span className={`platform-avatar ${action.platform}`}>{action.platform === 'x' ? 'X' : '◎'}</span>
      <div>
        <small>{platformLabel(action.platform)} · {age}</small>
        <strong>{candidate.displayName || `@${candidate.username}`}</strong>
        <span>@{candidate.username}</span>
      </div>
      <em className={action.executionMode === 'in_app' ? 'exec-mode in-app' : 'exec-mode handoff'}>
        {action.executionMode === 'in_app' ? 'IN_APP' : 'HANDOFF'}
      </em>
    </div>
    {action.inboundText && <p className="inbox-inbound">「{action.inboundText}」</p>}
    <p className="inbox-reason">{action.reason}</p>
    <p className="inbox-execute-note">
      {action.executionMode === 'in_app'
        ? '能力上はアプリ内実行できますが、現時点の書き込みは無効です。承認した1件だけ公式画面で行います。'
        : '公式APIがこの操作を許可しないため、承認した1件だけ公式画面で行います。'}
    </p>
    {showDraft && (action.draft !== undefined || action.aiDraft !== undefined) && <div className="draft-box">
      <span>返信案 · 編集できます</span>
      <textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} onBlur={() => onEditDraft(action.id, draftText)} rows={3} />
      <div className="draft-box-actions">
        {action.aiDraft !== undefined && draftText !== action.aiDraft && <button className="ghost-button" onClick={() => { setDraftText(action.aiDraft!); onEditDraft(action.id, action.aiDraft!); }}>元のAI案に戻す</button>}
        <button disabled={!draftText} onClick={() => copyDraft(draftText)}>コピー</button>
      </div>
    </div>}
    <div className="inbox-action-buttons">
      <button className="secondary-button" onClick={() => onSnooze(action.id)}>明日へ</button>
      <button className="ghost-button" onClick={() => onDismiss(action.id)}>今回は返さない</button>
      <button className="primary-button" onClick={() => onOpen(candidate, action)}>{cta}</button>
    </div>
  </article>;
}

function formatAge(value?: string) {
  if (!value) return 'いま';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return 'いま';
  const hours = Math.max(0, (Date.now() - then) / 3_600_000);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}分前`;
  if (hours < 24) return `${Math.round(hours)}時間前`;
  const days = Math.round(hours / 24);
  return `${days}日前`;
}
