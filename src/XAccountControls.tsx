import { useEffect, useState } from 'react';
import { apiConfigured, fetchSocialCapabilities, syncXDirectMessages, syncXInbound } from './api';
import { applyXDmEvents } from './dmInboundStore';
import { applyXInboundEvents } from './xInboundStore';
import { CONTROL_TOKEN_CHANGED_EVENT } from './controlToken';
import { applyOwnedXSyncWithDiscovery } from './xOwnedStore';
import { disconnectXOAuth, fetchXOAuthStatus, startXOAuth, syncOwnedXData, type XOAuthStatus } from './xAccount';
import { setLiveSocialCapabilities } from './socialCapabilities';
import type { AppState, AppStateUpdater } from './types';
import './xAccount.css';

const emptyStatus: XOAuthStatus = {
  configured: false,
  connected: false,
  scopes: [],
  expiresAt: null,
  updatedAt: null,
  refreshable: false,
};

export default function XAccountControls({ state, onChange }: { state: AppState; onChange: AppStateUpdater }) {
  const [status, setStatus] = useState<XOAuthStatus>(emptyStatus);
  const [loading, setLoading] = useState(apiConfigured);
  const [syncing, setSyncing] = useState(false);
  const [inboundSyncing, setInboundSyncing] = useState(false);
  const [dmSyncing, setDmSyncing] = useState(false);
  const [note, setNote] = useState(apiConfigured ? 'Xの接続状態を確認しています…' : 'X接続はまだ利用できません');

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const oauthResult = currentUrl.searchParams.get('x_oauth');
    if (oauthResult) {
      if (oauthResult === 'connected') {
        onChange((current) => ({ ...current, xAccount: {} }));
        setNote('X接続を更新しました。Xの情報を更新すると現在のアカウント情報を表示します');
      } else if (oauthResult === 'upgraded') {
        setNote('同じXアカウントへ権限を追加しました。既存の読み取りデータは残しています');
      } else if (oauthResult === 'account_mismatch') {
        setNote('別のXアカウントが選ばれたため権限追加を中止しました。以前の接続はそのままです');
      } else {
        setNote('X接続を完了できませんでした。もう一度接続をお試しください');
      }
      currentUrl.searchParams.delete('x_oauth');
      window.history.replaceState(window.history.state, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    }

    if (!apiConfigured) return;
    let cancelled = false;
    let requestGeneration = 0;

    const refreshStatus = () => {
      const generation = ++requestGeneration;
      setLoading(true);
      fetchXOAuthStatus()
        .then((next) => {
          if (cancelled || generation !== requestGeneration) return;
          setStatus(next);
          setNote(next.connected
            ? (next.capabilities?.reply ? '読み取りと返信権限で接続済みです' : '読み取り専用で接続済みです')
            : next.configured ? '接続できます' : 'X接続のサーバー設定がまだ完了していません');
          if (next.connected) {
            fetchSocialCapabilities().then(setLiveSocialCapabilities).catch(() => setLiveSocialCapabilities(null));
          }
        })
        .catch((error) => {
          if (cancelled || generation !== requestGeneration) return;
          setStatus(emptyStatus);
          setNote(error instanceof Error ? error.message : 'Xの接続状態を確認できませんでした');
        })
        .finally(() => {
          if (!cancelled && generation === requestGeneration) setLoading(false);
        });
    };

    refreshStatus();
    window.addEventListener(CONTROL_TOKEN_CHANGED_EVENT, refreshStatus);
    return () => {
      cancelled = true;
      requestGeneration += 1;
      window.removeEventListener(CONTROL_TOKEN_CHANGED_EVENT, refreshStatus);
    };
  }, []);

  async function connect() {
    setLoading(true);
    try {
      setNote('Xの接続確認画面を開いています…');
      await startXOAuth('read');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Xへの接続を開始できませんでした');
      setLoading(false);
    }
  }

  async function upgrade(intent: 'reply' | 'relationship' | 'engagement' | 'dm', label: string) {
    setLoading(true);
    try {
      setNote(`Xの確認画面で${label}だけを追加します…`);
      await startXOAuth(intent);
    } catch (error) {
      setNote(error instanceof Error ? error.message : `${label}の追加を開始できませんでした`);
      setLoading(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setNote('プロフィール・最近の投稿・フォロー関係を確認しています…');
    try {
      const result = await syncOwnedXData(state.budget.monthlyLimitUsd, state.candidates);
      if (!result.enabled) {
        setNote(result.reason || '現在はXデータを同期できません');
        return;
      }
      // Apply the network result to the latest state, not the snapshot captured when
      // the request started. This preserves edits made in other tabs while syncing.
      onChange((current) => {
        const syncedState = applyOwnedXSyncWithDiscovery(current, result);
        return {
          ...syncedState,
          xAccount: {
            ...syncedState.xAccount,
            followerCycle: result.coverage?.followers.cycle ?? syncedState.xAccount.followerCycle,
            followingCycle: result.coverage?.following.cycle ?? syncedState.xAccount.followingCycle,
            lastSyncCostUsd: result.costUsd,
            pacedCapUsd: result.pacing?.pacedCapUsd ?? syncedState.xAccount.pacedCapUsd,
            pacingDaysRemaining: result.pacing?.daysRemaining ?? syncedState.xAccount.pacingDaysRemaining,
          },
        };
      });
      const source = result.source === 'cache' ? '保存済みデータ' : 'X公式データ';
      const cost = result.costUsd > 0 ? ` · $${result.costUsd.toFixed(4)}` : ' · $0';
      const evidence = result.followEvidence?.complete
        ? ` · フォローバック確認${result.followEvidence.targetCount}人分を完了`
        : '';
      if (result.persistenceDegraded) {
        setNote(result.reason || `${source}は取得できました${cost}${evidence}。ただし次回位置を保存できなかったため、D1を確認するまで再更新しないでください`);
      } else if (result.followEvidenceDegraded) {
        // The paid page itself is safely checkpointed; only this follow-back proof cycle was
        // discarded. Do not tell the user to retry immediately—the next normal refresh can
        // continue from the saved cursor without re-reading the same paid page.
        setNote(result.reason || `${source}は更新しました${cost}。フォローバック確認だけ安全のため今回の判定を破棄し、次の確認周回から再開します`);
      } else {
        setNote(`${source}から更新しました${cost}${evidence}`);
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Xデータを更新できませんでした');
    } finally {
      setSyncing(false);
    }
  }

  async function syncInbound() {
    setInboundSyncing(true);
    setNote('Xのメンションと返信を確認しています…');
    try {
      const result = await syncXInbound('local-user', state.budget.monthlyLimitUsd);
      if (!result.enabled) {
        setNote(result.reason || '現在はXの受信メンションを同期できません');
        return;
      }
      onChange((current) => applyXInboundEvents(current, result));
      setNote(`Xの受信 ${result.events.length}件をMission Inboxへ反映しました · $${result.costUsd.toFixed(4)}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Xの受信を更新できませんでした');
    } finally {
      setInboundSyncing(false);
    }
  }

  async function syncDm() {
    setDmSyncing(true);
    setNote('XのDMを確認しています…');
    try {
      const result = await syncXDirectMessages('local-user', state.budget.monthlyLimitUsd);
      if (!result.enabled) {
        setNote(result.reason || '現在はXのDMを同期できません');
        return;
      }
      onChange((current) => applyXDmEvents(current, Array.isArray(result.events) ? result.events as never : []));
      setNote(`X DM ${Array.isArray(result.events) ? result.events.length : 0}件をMission Inboxへ反映しました · $${(result.costUsd || 0).toFixed(4)}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'XのDMを更新できませんでした');
    } finally {
      setDmSyncing(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    try {
      await disconnectXOAuth();
      setStatus((current) => ({ ...current, connected: false, expiresAt: null, updatedAt: null }));
      // Keep candidates/history, but remove account-level summary that belongs to the
      // disconnected identity so a later reconnect cannot display stale account stats.
      onChange((current) => ({ ...current, xAccount: {} }));
      setNote('Xとの接続を解除しました。候補や過去の関係記録は残ります');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Xとの接続を解除できませんでした');
    } finally {
      setLoading(false);
    }
  }

  return <section className="form-card x-account-card">
    <div className="field-title">
      <div><strong>Xを接続</strong><span>自分の発信とフォロー関係を、候補選びと自己分析へ反映します</span></div>
      <b className={status.connected ? 'connected' : ''}>{status.connected ? '接続済' : 'X'}</b>
    </div>

    <div className="x-scope-note">
      <strong>既定は読み取り接続です</strong>
      <span>プロフィール・投稿・フォロー関係の読み取りだけを使います。返信・フォロー・いいね・DMの書き込み権限は、それぞれ専用ボタンを押したときだけ、いま持っている権限の上に積み上げて要求します。既定の接続は常に読み取り専用です。勝手にフォロー、解除、いいね、投稿、DM送信することはありません。</span>
    </div>

    {status.connected && <div className="x-capability-list" aria-label="Xの接続権限">
      <span>{status.capabilities?.read !== false ? '✓ 読み取り 許可' : '− 読み取り 未許可'}</span>
      <span>{status.capabilities?.reply ? '✓ 返信 許可' : '− 返信 未許可'}</span>
      <span>{status.capabilities?.follow ? '✓ フォロー 許可' : '− フォロー 未許可'}</span>
      <span>{status.capabilities?.like ? '✓ いいね 許可' : '− いいね 未許可'}</span>
      <span>{status.capabilities?.dm ? '✓ DM 許可' : '− DM 未許可'}</span>
    </div>}

    {status.connected && !status.capabilities?.reply && <div className="x-scope-note x-upgrade-note">
      <strong>アプリ内返信には返信権限が必要です</strong>
      <span>追加で要求するのは tweet.write だけです。フォローやDMの権限は追加しません。Xの確認画面で同意したあと、サーバー側の書き込み設定が有効なときだけ Mission Inbox から1件送信できます。</span>
    </div>}

    {status.connected && <div className="x-connection-details">
      <span><b>状態</b> {status.capabilities?.reply ? '読み取りと返信権限で接続済み' : '読み取り専用で接続済み'}{status.refreshable ? ' · 接続を自動維持' : ''}</span>
      {state.xAccount.username && <span><b>接続中</b> @{state.xAccount.username}</span>}
      {state.xAccount.lastSyncedAt && <span><b>最終更新</b> {new Date(state.xAccount.lastSyncedAt).toLocaleString('ja-JP')}</span>}
    </div>}

    {status.connected && state.xAccount.username && <>
      <div className="x-sync-summary">
        <span><b>{state.xAccount.followerSampleCount || 0}</b> フォロワー確認</span>
        <span><b>{state.xAccount.followingSampleCount || 0}</b> フォロー中確認</span>
        <span><b>{state.xAccount.recentPostCount || 0}</b> 最近の投稿</span>
      </div>
      <details className="candidate-details">
        <summary>今回の確認範囲を見る</summary>
        <div className="candidate-details-body x-pacing-note">
          <span>フォロワー確認 <b>{(state.xAccount.followerCycle || 0) + 1}周目</b></span>
          <span>フォロー中確認 <b>{(state.xAccount.followingCycle || 0) + 1}周目</b></span>
          {state.xAccount.pacedCapUsd != null && <span>今回の利用上限 <b>${state.xAccount.pacedCapUsd.toFixed(3)}</b></span>}
          {state.xAccount.pacingDaysRemaining != null && <span>月末まで <b>{state.xAccount.pacingDaysRemaining}日</b></span>}
        </div>
      </details>
    </>}

    <details className="candidate-details">
      <summary>読み取り権限の詳細</summary>
      <div className="candidate-details-body strategy-note"><p>既定の接続は tweet.read / users.read / follows.read / offline.access のみです。返信は tweet.write、フォローは follows.write、いいねは like.read + like.write、DMは dm.read+dm.write を、それぞれ専用ボタンで累積追加します。既定接続で書き込み権限をまとめて要求することはありません。権限追加は同じXアカウントのまま行われます。</p></div>
    </details>

    <div className="x-account-actions">
      {!status.connected
        ? <button className="primary-button" disabled={loading || !apiConfigured || !status.configured} onClick={connect}>{loading ? '確認中…' : 'Xを読み取り専用で接続'}</button>
        : <>
          <button className="primary-button" disabled={syncing || loading || inboundSyncing || dmSyncing} onClick={sync}>{syncing ? '更新中…' : 'Xの情報を更新'}</button>
          <button className="secondary-button" disabled={syncing || loading || inboundSyncing || dmSyncing} onClick={syncInbound}>{inboundSyncing ? '受信を確認中…' : 'メンション/返信を取り込む'}</button>
          <button className="secondary-button" disabled={syncing || loading || inboundSyncing || dmSyncing} onClick={() => void syncDm()}>{dmSyncing ? 'DM確認中…' : 'DMを取り込む'}</button>
          {!status.capabilities?.reply && <button className="secondary-button" disabled={loading || syncing || inboundSyncing || dmSyncing} onClick={() => void upgrade('reply', '返信権限')}>{loading ? '処理中…' : '返信権限を追加'}</button>}
          {!status.capabilities?.follow && <button className="secondary-button" disabled={loading || syncing || inboundSyncing || dmSyncing} onClick={() => void upgrade('relationship', 'フォロー権限')}>{loading ? '処理中…' : 'フォロー権限を追加'}</button>}
          {!status.capabilities?.like && <button className="secondary-button" disabled={loading || syncing || inboundSyncing || dmSyncing} onClick={() => void upgrade('engagement', 'いいね権限')}>{loading ? '処理中…' : 'いいね権限を追加'}</button>}
          {!status.capabilities?.dm && <button className="secondary-button" disabled={loading || syncing || inboundSyncing || dmSyncing} onClick={() => void upgrade('dm', 'DM権限')}>{loading ? '処理中…' : 'DM権限を追加'}</button>}
          <button className="secondary-button" disabled={loading || syncing || inboundSyncing || dmSyncing} onClick={disconnect}>{loading ? '処理中…' : 'Xとの接続を解除'}</button>
        </>}
    </div>
    <small>{note}</small>
    <small className="x-account-warning">「フォローバックなし」は、追跡中の相手を一通り確認し終えた場合だけ反映します。途中までしか取得できていない状態で、相手がフォローしていないと決めつけません。</small>
  </section>;
}