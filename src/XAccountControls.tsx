import { useEffect, useState } from 'react';
import { friendlyReason } from './friendlyReason';
import { apiConfigured, fetchSocialCapabilities, syncXDirectMessages, syncXInbound } from './api';
import { applyXDmEvents } from './dmInboundStore';
import { applyXInboundEvents } from './xInboundStore';
import { CONTROL_TOKEN_CHANGED_EVENT } from './controlToken';
import { applyOwnedXSyncWithDiscovery } from './xOwnedStore';
import { disconnectXOAuth, fetchXOAuthStatus, startXOAuth, syncOwnedXData, type XOAuthStatus } from './xAccount';
import { setLiveSocialCapabilities } from './socialCapabilities';
import type { AppState, AppStateUpdater } from './types';
import { spendingCeilingUsd } from './store';
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
      const result = await syncOwnedXData(spendingCeilingUsd(state.budget), state.candidates);
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
      const result = await syncXInbound('local-user', spendingCeilingUsd(state.budget));
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
      const result = await syncXDirectMessages('local-user', spendingCeilingUsd(state.budget));
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

  const busy = loading || syncing || inboundSyncing || dmSyncing;
  return <section className="form-card x-account-card">
    <div className="field-title">
      <div><strong>Xをつなぐ</strong><span>{status.connected ? (state.xAccount.username ? `@${state.xAccount.username} と接続中` : '接続中') : 'まだ接続していません'}</span></div>
      <b className={status.connected ? 'connected' : ''}>{status.connected ? '接続済' : 'X'}</b>
    </div>

    {!status.connected && <div className="x-scope-note">
      <strong>つなぐとできること</strong>
      <span>① 自分のプロフィール・投稿・フォロー関係をAIが分析 ② 届いたメンションや返信が「今日」に並ぶ ③ 承認した返信だけアプリから送れる。最初の接続は「読み取りだけ」です。勝手に投稿・フォロー・DMはしません。</span>
    </div>}
    {!status.connected && apiConfigured && !loading && !status.configured && <div className="x-scope-note x-upgrade-note">
      <strong>先にサーバー側の準備が必要です</strong>
      <span>X Developer Portal でアプリを作り、Client ID などをサーバーに登録すると、下のボタンが押せるようになります。設定 →「Xとつなぐ」の案内を見てください。</span>
    </div>}

    {status.connected && <div className="x-capability-list" aria-label="Xの接続権限">
      <span>{status.capabilities?.read !== false ? '✓ 読み取り' : '− 読み取り'}</span>
      <span>{status.capabilities?.reply ? '✓ 返信' : '− 返信'}</span>
      <span>{status.capabilities?.dm ? '✓ DM' : '− DM'}</span>
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
          {state.xAccount.lastSyncedAt && <span>最終更新 <b>{new Date(state.xAccount.lastSyncedAt).toLocaleString('ja-JP')}</b></span>}
        </div>
      </details>
    </>}

    <div className="x-account-actions">
      {!status.connected
        ? <button className="primary-button" disabled={loading || !apiConfigured || !status.configured} onClick={connect}>{loading ? '確認中…' : 'Xを読み取り専用で接続'}</button>
        : <>
          <button className="primary-button" disabled={busy} onClick={sync}>{syncing ? '更新中…' : 'Xの情報を更新'}</button>
          <button className="secondary-button" disabled={busy} onClick={syncInbound}>{inboundSyncing ? '受信を確認中…' : 'メンション/返信を取り込む'}</button>
          {status.capabilities?.dm && <button className="secondary-button" disabled={busy} onClick={() => void syncDm()}>{dmSyncing ? 'DM確認中…' : 'DMを取り込む'}</button>}
        </>}
    </div>
    <small>{friendlyReason(note)}</small>

    {status.connected && <details className="candidate-details">
      <summary>できることを増やす（返信・DM）</summary>
      <div className="candidate-details-body strategy-note">
        <p>押すとXの確認画面が開き、その権限だけを追加します。追加後もサーバー側で送信をオンにするまでは送られません（ガイド「X連携」手順⑨）。</p>
        <div className="x-account-actions">
          {!status.capabilities?.reply && <button className="secondary-button" disabled={busy} onClick={() => void upgrade('reply', '返信権限')}>{loading ? '処理中…' : '返信権限を追加'}</button>}
          {!status.capabilities?.dm && <button className="secondary-button" disabled={busy} onClick={() => void upgrade('dm', 'DM権限')}>{loading ? '処理中…' : 'DM権限を追加'}</button>}
          {status.capabilities?.reply && status.capabilities?.dm && <p>返信とDMの権限は追加済みです。</p>}
        </div>
      </div>
    </details>}

    {status.connected && <details className="candidate-details">
      <summary>フォロー・いいねについて（通常は不要）</summary>
      <div className="candidate-details-body strategy-note">
        <p>2026年4月から、Xの通常プラン（従量課金）ではAPIでのフォロー・いいねができなくなりました（企業向け Enterprise 契約のみ）。このアプリはフォロー・いいねのときXアプリを開くので、下のボタンは押さなくて大丈夫です。</p>
        <div className="x-account-actions">
          {!status.capabilities?.follow && <button className="secondary-button" disabled={busy} onClick={() => void upgrade('relationship', 'フォロー権限')}>{loading ? '処理中…' : 'フォロー権限を追加'}</button>}
          {!status.capabilities?.like && <button className="secondary-button" disabled={busy} onClick={() => void upgrade('engagement', 'いいね権限')}>{loading ? '処理中…' : 'いいね権限を追加'}</button>}
        </div>
      </div>
    </details>}

    <details className="candidate-details">
      <summary>くわしい仕組み</summary>
      <div className="candidate-details-body strategy-note">
        <p>最初の接続で使う権限は tweet.read / users.read / follows.read / offline.access（読み取りだけ）です。返信は tweet.write、DMは dm.read + dm.write を、上のボタンを押したときだけ同じアカウントに追加します。Xのトークンは暗号化してサーバーに保存し、この端末には置きません。</p>
        <p>「フォローバックなし」は、追跡中の相手を一通り確認し終えた場合だけ表示します。途中までしか確認できていないときに、相手がフォローしていないと決めつけません。</p>
      </div>
    </details>

    {status.connected && <button className="text-button x-disconnect" disabled={busy} onClick={disconnect}>{loading ? '処理中…' : 'Xとの接続を解除'}</button>}
  </section>;
}