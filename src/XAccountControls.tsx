import { useEffect, useState } from 'react';
import { apiConfigured } from './api';
import { CONTROL_TOKEN_CHANGED_EVENT } from './controlToken';
import { applyOwnedXSyncWithDiscovery } from './xOwnedStore';
import { disconnectXOAuth, fetchXOAuthStatus, startXOAuth, syncOwnedXData, type XOAuthStatus } from './xAccount';
import type { AppState } from './types';
import './xAccount.css';

const emptyStatus: XOAuthStatus = {
  configured: false,
  connected: false,
  scopes: [],
  expiresAt: null,
  updatedAt: null,
  refreshable: false,
};

export default function XAccountControls({ state, onChange }: { state: AppState; onChange: (state: AppState) => void }) {
  const [status, setStatus] = useState<XOAuthStatus>(emptyStatus);
  const [loading, setLoading] = useState(apiConfigured);
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState(apiConfigured ? '接続状態を確認中…' : 'Worker未接続');

  useEffect(() => {
    if (!apiConfigured) return;
    let cancelled = false;

    const refreshStatus = () => {
      setLoading(true);
      fetchXOAuthStatus()
        .then((next) => {
          if (cancelled) return;
          setStatus(next);
          setNote(next.connected ? '読み取り専用で接続済み' : next.configured ? '接続できます' : 'Worker側のX OAuth設定が未完了です');
        })
        .catch((error) => {
          if (cancelled) return;
          setStatus(emptyStatus);
          setNote(error instanceof Error ? error.message : '接続状態の確認に失敗しました');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };

    refreshStatus();
    window.addEventListener(CONTROL_TOKEN_CHANGED_EVENT, refreshStatus);
    return () => {
      cancelled = true;
      window.removeEventListener(CONTROL_TOKEN_CHANGED_EVENT, refreshStatus);
    };
  }, []);

  async function connect() {
    setLoading(true);
    try {
      setNote('Xの読み取り専用認可へ移動します…');
      await startXOAuth();
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'X接続開始に失敗しました');
      setLoading(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setNote('自分のXプロフィール・最近の投稿・フォロー関係を同期中…');
    try {
      const result = await syncOwnedXData(state.budget.monthlyLimitUsd, state.candidates);
      if (!result.enabled) {
        setNote(result.reason || 'X owned-read同期は現在無効です');
        return;
      }
      const beforeCount = state.candidates.length;
      const syncedState = applyOwnedXSyncWithDiscovery(state, result);
      const nextState: AppState = {
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
      const addedCandidates = Math.max(0, nextState.candidates.length - beforeCount);
      onChange(nextState);
      const source = result.source === 'cache' ? 'キャッシュ' : 'X公式API';
      const cost = result.costUsd > 0 ? ` · $${result.costUsd.toFixed(4)}` : ' · $0';
      const added = addedCandidates > 0 ? ` · 新規候補${addedCandidates}人` : '';
      const evidence = result.followEvidence?.complete
        ? ` · フォロバ判定${result.followEvidence.targetCount}人分を1周完了`
        : '';
      setNote(`${source}から同期完了${cost}${added}${evidence}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Xデータ同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  }

  async function disconnect() {
    setLoading(true);
    try {
      await disconnectXOAuth();
      setStatus((current) => ({ ...current, connected: false, expiresAt: null, updatedAt: null }));
      setNote('Worker内のX接続トークンを削除しました');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'X接続解除に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  return <section className="form-card x-account-card">
    <div className="field-title">
      <div><strong>Xアカウント</strong><span>自分のプロフィール・投稿・フォロー関係をMission分析へ反映</span></div>
      <b className={status.connected ? 'connected' : ''}>{status.connected ? 'READ' : 'X'}</b>
    </div>

    <div className="x-scope-note">
      <strong>書き込み権限は要求しません</strong>
      <span>`tweet.read` / `users.read` / `follows.read` / `offline.access` のみ。フォロー・解除・投稿・DM送信権限は取りません。</span>
    </div>

    {status.connected && <div className="x-connection-details">
      <span><b>状態</b> 接続済み{status.refreshable ? ' · 自動refresh対応' : ''}</span>
      <span><b>Scopes</b> {status.scopes.join(' · ') || 'read-only'}</span>
      {status.updatedAt && <span><b>Token更新</b> {new Date(status.updatedAt).toLocaleString('ja-JP')}</span>}
      {state.xAccount.username && <span><b>同期アカウント</b> @{state.xAccount.username}</span>}
      {state.xAccount.lastSyncedAt && <span><b>データ同期</b> {new Date(state.xAccount.lastSyncedAt).toLocaleString('ja-JP')}</span>}
    </div>}

    {state.xAccount.username && <>
      <div className="x-sync-summary">
        <span><b>{state.xAccount.followerSampleCount || 0}</b> followers確認</span>
        <span><b>{state.xAccount.followingSampleCount || 0}</b> following確認</span>
        <span><b>{state.xAccount.recentPostCount || 0}</b> posts取得</span>
      </div>
      <div className="x-pacing-note">
        <span>followers巡回 <b>{(state.xAccount.followerCycle || 0) + 1}周目</b></span>
        <span>following巡回 <b>{(state.xAccount.followingCycle || 0) + 1}周目</b></span>
        {state.xAccount.pacedCapUsd != null && <span>今回ペース上限 <b>${state.xAccount.pacedCapUsd.toFixed(3)}</b></span>}
        {state.xAccount.pacingDaysRemaining != null && <span>月末まで <b>{state.xAccount.pacingDaysRemaining}日</b></span>}
      </div>
    </>}

    <div className="x-account-actions">
      {!status.connected
        ? <button className="primary-button" disabled={loading || !apiConfigured || !status.configured} onClick={connect}>{loading ? '確認中…' : 'Xを読み取り専用で接続'}</button>
        : <>
          <button className="primary-button" disabled={syncing || loading} onClick={sync}>{syncing ? '同期中…' : 'Xデータを同期'}</button>
          <button className="secondary-button" disabled={loading || syncing} onClick={disconnect}>{loading ? '処理中…' : 'X接続を外す'}</button>
        </>}
    </div>
    <small>{note}</small>
    <small className="x-account-warning">フォローバックの否定判定は、周回開始時に追跡中だったフォロー済み候補を1周最後まで確認できた場合だけ反映します。部分ページから「フォロバなし」とは判定しません。</small>
  </section>;
}
