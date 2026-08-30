import { useEffect, useMemo, useRef, useState } from 'react';
import { apiConfigured, dismissSocialActionRequest, executeSocialActionRequest, prepareSocialActionRequest, reconcileSocialExecutionRequest, snoozeSocialActionRequest } from './api';
import DailyQueue from './DailyQueue';
import { buildMissionInbox, inboxSummary, type MissionInboxItem } from './missionInbox';
import { copyDraft, platformLabel } from './social';
import { capabilitiesForPlatform, executionModeForAction, getLiveSocialCapabilities } from './socialCapabilities';
import { completeInboxAction, dismissInboxAction, snoozeInboxAction, updateSocialActionDraft } from './store';
import { failSocialAction, markUnknownSocialAction, whyThisActionToday } from './socialAction';
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
  capabilityEpoch?: number;
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

export default function MissionInbox({ state, onChange, onOpenCandidate, onOpenMe, onOpenDiscover, capabilityEpoch }: Props) {
  const localDay = useLocalDayKey();
  const items = useMemo(() => buildMissionInbox(state), [state, localDay, capabilityEpoch]);
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
      <span><b>{summary.nurture}</b>育てる</span>
      <span><b>{summary.cleanup}</b>整える</span>
    </div>
    {first.action && first.candidate && (
      <SocialActionCard
        featured
        action={first.action}
        candidate={first.candidate}
        onOpen={onOpenCandidate}
        onSnooze={async (actionId) => {
          if (apiConfigured) {
            try {
              const result = await snoozeSocialActionRequest(actionId);
              if (result.ok === false && result.code !== 'NOT_FOUND') return;
            } catch {
              return;
            }
          }
          onChange((current) => snoozeInboxAction(current, actionId));
        }}
        onDismiss={async (actionId) => {
          if (apiConfigured) {
            try {
              const result = await dismissSocialActionRequest(actionId);
              if (result.ok === false && result.code !== 'NOT_FOUND') return;
            } catch {
              return;
            }
          }
          onChange((current) => dismissInboxAction(current, actionId));
        }}
        onEditDraft={(actionId, draft) => onChange((current) => updateSocialActionDraft(current, actionId, draft))}
        onChange={onChange}
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
  onChange,
}: {
  action: SocialAction;
  candidate: Candidate;
  featured?: boolean;
  onOpen: (candidate: Candidate, action?: SocialAction) => void;
  onSnooze: (actionId: string) => void | Promise<void>;
  onDismiss: (actionId: string) => void | Promise<void>;
  onEditDraft: (actionId: string, draft: string) => void;
  onChange: AppStateUpdater;
}) {
  const [draftText, setDraftText] = useState(action.draft ?? action.aiDraft ?? '');
  const [confirming, setConfirming] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [note, setNote] = useState('');
  const executionIds = useRef<Record<string, string>>({});
  useEffect(() => setDraftText(action.draft ?? action.aiDraft ?? ''), [action.draft, action.aiDraft]);
  const showDraft = action.type === 'comment_reply'
    || action.type === 'reply_inbound'
    || action.type === 'reply_outbound'
    || action.type === 'dm_reply'
    || action.type === 'dm_outbound';
  const age = formatAge(action.observedAt || action.createdAt);
  const liveCaps = capabilitiesForPlatform(action.platform);
  const identityConflict = candidate.tags.includes('identity-conflict');
  const liveSnapshot = getLiveSocialCapabilities();
  const liveMode = identityConflict
    ? 'handoff'
    : (liveSnapshot
      ? executionModeForAction(action.type, liveCaps)
      : action.executionMode);
  const inAppWrite = liveMode === 'in_app' && apiConfigured && Boolean(liveSnapshot) && (
    (action.type === 'comment_reply' && Boolean(liveSnapshot?.instagram.sendCommentReply))
    || ((action.type === 'reply_inbound' || action.type === 'reply_outbound') && Boolean(liveSnapshot?.x.sendReply))
    || ((action.type === 'dm_reply' || action.type === 'dm_outbound') && (
      action.platform === 'x' ? Boolean(liveSnapshot?.x.sendDm) : Boolean(liveSnapshot?.instagram.sendDm)
    ))
    || (action.type === 'follow' && action.platform === 'x' && Boolean(liveSnapshot?.x.follow))
    || (action.type === 'like' && action.platform === 'x' && Boolean(liveSnapshot?.x.like))
    || (action.type === 'unfollow_review' && action.platform === 'x' && Boolean(liveSnapshot?.x.unfollow))
  );
  const writeSurface = action.platform === 'x' ? 'X' : 'Instagram';
  const unknown = action.unknownExecution || action.status === 'executing';
  const cta = unknown
    ? '結果を再確認'
    : inAppWrite
      ? (action.type === 'follow' ? 'フォローする'
        : action.type === 'like' ? 'いいねする'
          : action.type === 'unfollow_review' ? 'フォローを外す'
            : action.type === 'dm_reply' || action.type === 'dm_outbound' ? 'DMする'
              : '返信する')
      : `${platformLabel(action.platform)}で開く`;

  async function sendApprovedWrite() {
    if (executing) return;
    persistDraft();
    if (showDraft && !draftText.trim()) {
      setNote('返信文を入力してください');
      return;
    }
    setExecuting(true);
    setNote(`${writeSurface}へ送信しています…`);
    let actionId = action.id;
    try {
      if (action.platform === 'x' && (action.type === 'follow' || action.type === 'like' || action.type === 'unfollow_review') && !/^sa-x-(?:follow|unfollow|like)-/.test(action.id)) {
        const prepared = await prepareSocialActionRequest({
          candidateId: action.candidateId,
          type: action.type,
          username: candidate.username,
          platformUserId: candidate.platformUserId,
          engagementUrl: candidate.engagementUrl || action.targetUrl,
        });
        if (!prepared.ok || !prepared.action?.id) {
          setNote(prepared.reason || '公式IDを確認できないため、公式アプリで行います。');
          setExecuting(false);
          onOpen(candidate, action);
          return;
        }
        if (prepared.executionMode === 'handoff') {
          setNote(prepared.reason || '公式アプリで行います。');
          setExecuting(false);
          onOpen(candidate, action);
          return;
        }
        actionId = prepared.action.id;
      }
      const executionId = durableExecutionId();
      const result = await executeSocialActionRequest(actionId, { executionId, draft: draftText.trim() });
      if (result.ok && (result.status === 'succeeded' || result.certainty === 'success')) {
        onChange((current) => completeInboxAction(current, action.id, {
          executionId,
          externalResultId: result.externalResultId || undefined,
          pendingFollow: result.pendingFollow === true || result.metadata?.pendingFollow === true,
        }));
        setConfirming(false);
        setNote('');
        return;
      }
      if ((!result.ok && (result.code === 'UNKNOWN_RESULT' || result.certainty === 'unknown' || result.status === 'unknown' || result.status === 'executing'))
        || (result.ok && result.certainty === 'unknown')) {
        onChange((current) => markUnknownSocialAction(current, action.id, executionId));
        setNote('送信結果を確認しています');
        return;
      }
      if (result.ok && result.idempotent && result.status === 'succeeded') {
        onChange((current) => completeInboxAction(current, action.id, {
          executionId,
          externalResultId: result.externalResultId || undefined,
          pendingFollow: result.pendingFollow === true || result.metadata?.pendingFollow === true,
        }));
        setConfirming(false);
        setNote('');
        return;
      }
      delete executionIds.current[action.id];
      const reason = 'ok' in result && result.ok === false ? result.reason : '送信できませんでした';
      onChange((current) => failSocialAction(current, action.id, reason));
      setNote(reason);
    } catch {
      setNote('送信結果を確認しています');
      onChange((current) => markUnknownSocialAction(current, action.id, durableExecutionId()));
    } finally {
      setExecuting(false);
    }
  }

  async function reconcileUnknown() {
    const executionId = action.executionId || durableExecutionId();
    setExecuting(true);
    setNote('送信結果を確認しています');
    try {
      const result = await reconcileSocialExecutionRequest(executionId);
      if (result.status === 'succeeded' || result.certainty === 'success') {
        onChange((current) => completeInboxAction(current, action.id, { executionId }));
        setNote('');
        return;
      }
      if (result.status === 'failed' || result.certainty === 'failure') {
        onChange((current) => failSocialAction(current, action.id, String(result.reason || '送信できませんでした')));
        setNote(String(result.reason || '送信できませんでした'));
        return;
      }
      setNote('まだ結果を確定できません。新しい送信はしません。');
    } catch (error) {
      setNote(error instanceof Error ? error.message : '結果を確認できませんでした');
    } finally {
      setExecuting(false);
    }
  }

  function persistDraft() {
    onEditDraft(action.id, draftText);
  }

  function durableExecutionId() {
    if (!executionIds.current[action.id]) executionIds.current[action.id] = `exec-${crypto.randomUUID()}`;
    return executionIds.current[action.id];
  }

  function onPrimary() {
    if (unknown) {
      void reconcileUnknown();
      return;
    }
    if (inAppWrite) {
      persistDraft();
      setConfirming(true);
      setNote('');
      return;
    }
    onOpen(candidate, action);
  }

  return <article className={featured ? 'inbox-action-card featured' : 'inbox-action-card'}>
    <div className="inbox-action-meta">
      <span className={`platform-avatar ${action.platform}`}>{action.platform === 'x' ? 'X' : '◎'}</span>
      <div>
        <small>{platformLabel(action.platform)} · {age}</small>
        <strong>{candidate.displayName || `@${candidate.username}`}</strong>
        <span>@{candidate.username}</span>
      </div>
      <em className={inAppWrite ? 'exec-mode in-app' : 'exec-mode handoff'}>
        {inAppWrite ? 'IN_APP' : 'HANDOFF'}
      </em>
    </div>
    {action.inboundText && <p className="inbox-inbound">「{action.inboundText}」</p>}
    <p className="inbox-why"><span>今日やる理由</span>{whyThisActionToday(action)}</p>
    <p className="inbox-reason">{action.reason}</p>
    <p className="inbox-execute-note">
      {unknown
        ? '送信結果を確認しています。同じ実行の結果だけを再確認します。もう一度送る操作はありません。'
        : inAppWrite
          ? `承認した1件だけ、この画面から${writeSurface}へ実行できます。自動送信はありません。`
          : liveMode === 'in_app'
            ? '能力上はアプリ内実行できますが、いまの接続では公式画面で行います。'
            : '公式APIがこの操作を許可しないため、承認した1件だけ公式画面で行います。'}
    </p>
    {showDraft && (action.draft !== undefined || action.aiDraft !== undefined || inAppWrite) && <div className="draft-box">
      <span>返信案 · 編集できます</span>
      <textarea value={draftText} onChange={(event) => setDraftText(event.target.value)} onBlur={() => onEditDraft(action.id, draftText)} rows={3} />
      <div className="draft-box-actions">
        {action.aiDraft !== undefined && draftText !== action.aiDraft && <button className="ghost-button" onClick={() => { setDraftText(action.aiDraft!); onEditDraft(action.id, action.aiDraft!); }}>元のAI案に戻す</button>}
        <button disabled={!draftText} onClick={() => copyDraft(draftText)}>コピー</button>
      </div>
    </div>}
    {confirming && inAppWrite && <div className="inbox-confirm" role="status">
      <strong>{action.type === 'unfollow_review' ? 'このアカウントのフォローを外します。よろしいですか？' : `この内容を${writeSurface}に送信します。よろしいですか？`}</strong>
      <p>{action.type === 'unfollow_review' ? 'フォロー解除は1件ずつ、あなたが承認したときだけです。一括解除はありません。' : '送信はあなたが承認したこの1件だけです。'}</p>
    </div>}
    {note && <p className="inbox-execute-status">{note}</p>}
    <div className="inbox-action-buttons">
      <button className="secondary-button" disabled={executing} onClick={() => onSnooze(action.id)}>明日へ</button>
      <button className="ghost-button" disabled={executing} onClick={() => onDismiss(action.id)}>今回は返さない</button>
      {unknown ? (
        <button className="primary-button" disabled={executing} onClick={() => void reconcileUnknown()}>
          {executing ? '確認中…' : '結果を再確認'}
        </button>
      ) : confirming && inAppWrite ? <>
        <button className="ghost-button" disabled={executing} onClick={() => { if (!executing) setConfirming(false); }}>キャンセル</button>
        <button className="primary-button" disabled={executing || (showDraft && !draftText.trim())} onClick={() => void sendApprovedWrite()}>
          {executing ? '送信中…' : '送信する'}
        </button>
      </> : <button className="primary-button" disabled={executing} onClick={onPrimary}>{cta}</button>}
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
