import { useEffect, useState } from 'react';
import { apiConfigured } from './api';
import { CONTROL_TOKEN_CHANGED_EVENT } from './controlToken';
import { applyOwnedXSyncWithDiscovery } from './xOwnedStore';
import { disconnectXOAuth, fetchXOAuthStatus, startXOAuth, syncOwnedXData, type XOAuthStatus } from './xAccount';
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
  const [note, setNote] = useState(apiConfigured ? 'Xの接続状態を確認しています…' : 'X接続はまだ利用できません');

  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    const oauthResult = currentUrl.searchParams.get('x_oauth');
    if (oauthResult) {
      if (oauthResult === 'connected') {
        // The callback may represent reauthorization or a switch to another X account.
        // Server-side derived cache is cleared in both cases, so the old local @username
        // and stats must not be displayed as if they belonged to the new connection.
        onChange((current) => ({ ...current, xAccount: {} }));
        setNote('X接続を更新しました。Xの情報を更新すると現在のアカウント情報を表示します');
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
          setNote(next.connected ? '読み取り専用で接続済みです' : next.configured ? '接続できます' : 'X接続のサーバー設定がまだ完了していません');
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
      await startXOAuth();
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Xへの接続を開始できませんでした');
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
      setNote(`${source}から更新しました${cost}${evidence}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Xデータを更新できませんでした');
    } finally {
      setSyncing(false);
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
      <strong>見るだけの接続です</strong>
      <span>プロフィール・投稿・フォロー関係の読み取りだけを使います。このアプリが勝手にフォロー、解除、投稿、DM送信することはありません。</span>
    </div>

    {status.connected && <div className="x-connection-details">
      <span><b>状態</b> 読み取り専用で接続済み{status.refreshable ? ' · 接続を自動維持' : ''}</span>
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
      <div className="candidate-details-body strategy-note"><p>使用する権限は tweet.read / users.read / follows.read / offline.access のみです。書き込み権限は要求しません。</p></div>
    </details>

    <div className="x-account-actions">
      {!status.connected
        ? <button className="primary-button" disabled={loading || !apiConfigured || !status.configured} onClick={connect}>{loading ? '確認中…' : 'Xを読み取り専用で接続'}</button>
        : <>
          <button className="primary-button" disabled={syncing || loading} onClick={sync}>{syncing ? '更新中…' : 'Xの情報を更新'}</button>
          <button className="secondary-button" disabled={loading || syncing} onClick={disconnect}>{loading ? '処理中…' : 'Xとの接続を解除'}</button>
        </>}
    </div>
    <small>{note}</small>
    <small className="x-account-warning">「フォローバックなし」は、追跡中の相手を一通り確認し終えた場合だけ反映します。途中までしか取得できていない状態で、相手がフォローしていないと決めつけません。</small>
  </section>;
}
