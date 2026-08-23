import { useState } from 'react';
import { apiConfigured, fetchBudget } from './api';
import { normalizeAppState, validateAppState } from './backup';
import { clearRemoteStateVersion, clearSyncToken, downloadRemoteState, getRemoteStateVersion, getSyncToken, setSyncToken, uploadRemoteState } from './sync';
import { syncBudget } from './store';
import type { AppState, AppStateUpdater } from './types';
import './sync.css';

export default function SyncControls({ state, onRestore }: { state: AppState; onRestore: AppStateUpdater }) {
  const [token, setToken] = useState(() => getSyncToken());
  const [status, setStatus] = useState(apiConfigured ? '未同期' : 'Worker未接続');
  const [busy, setBusy] = useState(false);

  async function saveToken() {
    const previous = getSyncToken().trim();
    const next = token.trim();
    if (!next) {
      const tokenCleared = clearSyncToken();
      const versionCleared = clearRemoteStateVersion();
      setStatus(tokenCleared && versionCleared
        ? '個人管理キーを削除しました'
        : 'このセッションからキーを削除しましたが、ブラウザ保存領域の削除に失敗しました。再読み込み前にストレージ設定を確認してください。');
      return;
    }
    if (!apiConfigured) {
      const versionCleared = previous === next ? true : clearRemoteStateVersion();
      const tokenPersisted = setSyncToken(next);
      setStatus(tokenPersisted && versionCleared
        ? '個人管理キーをこの端末に保存しました · Worker未接続'
        : 'このセッションでは個人管理キーを使えますが、端末への永続保存に失敗しました · Worker未接続');
      return;
    }

    setBusy(true);
    setStatus('個人管理キーを確認中…');
    try {
      // Validate the candidate token directly. Do not stage an unverified replacement in
      // localStorage and then attempt a rollback if the Worker rejects it.
      const budget = await fetchBudget('local-user', next);
      const versionCleared = previous === next ? true : clearRemoteStateVersion();
      const tokenPersisted = setSyncToken(next);
      onRestore((current) => syncBudget(current, budget.usedUsd, budget.limitUsd));
      setStatus(tokenPersisted && versionCleared
        ? '個人管理キーを保存し、Worker接続を確認しました'
        : 'Worker接続は確認できました。このセッションでは使えますが、キーまたはD1版情報の端末保存に失敗しました。');
    } catch (error) {
      setToken(previous);
      const message = error instanceof Error ? error.message : '個人管理キーの確認に失敗しました';
      setStatus(`${message} · 変更は保存していません`);
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    setBusy(true);
    try {
      const previous = getSyncToken().trim();
      const next = token.trim();
      const expectedVersion = previous === next ? getRemoteStateVersion() : null;
      const result = await uploadRemoteState(state, next, 'local-user', expectedVersion);
      const tokenPersisted = setSyncToken(next);
      const persistenceWarning = tokenPersisted && result.versionPersisted
        ? ''
        : ' · 保存は成功しましたが端末のキー/版情報を永続保存できません。再読み込み前にストレージ設定を確認してください';
      setStatus(`D1へ安全に保存 · ${new Date(result.updatedAt).toLocaleString('ja-JP')}${persistenceWarning}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '同期アップロードに失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setBusy(true);
    try {
      const next = token.trim();
      const result = await downloadRemoteState(next);
      const tokenPersisted = setSyncToken(next);
      const persistenceWarning = tokenPersisted && result.versionPersisted
        ? ''
        : ' · このセッションでは利用できますが端末のキー/版情報を永続保存できません';
      if (!result.found || !result.state) {
        setStatus(`D1に保存済みデータはありません${persistenceWarning}`);
        return;
      }
      const restored = normalizeAppState(result.state);
      validateAppState(restored);
      onRestore(restored);
      setStatus(`D1から検証して復元 · ${result.updatedAt ? new Date(result.updatedAt).toLocaleString('ja-JP') : '日時不明'}${persistenceWarning}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '同期ダウンロードに失敗しました');
    } finally {
      setBusy(false);
    }
  }

  function forget() {
    const tokenCleared = clearSyncToken();
    const versionCleared = clearRemoteStateVersion();
    setToken('');
    setStatus(tokenCleared && versionCleared
      ? 'この端末の個人管理キーとD1同期バージョンを削除しました'
      : 'このセッションではキーを忘れましたが、ブラウザ保存領域の削除に失敗しました。ストレージ設定を確認してください。');
  }

  return <section className="form-card sync-card">
    <div className="field-title"><div><strong>個人管理キー / D1同期</strong><span>X接続の保護と、別端末へのMission・候補・関係性引き継ぎ</span></div><b>KEY</b></div>
    <label>個人管理キー<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Worker側のSHA-256元キー" /></label>
    <div className="sync-actions">
      <button className="secondary-button" disabled={busy} onClick={saveToken}>キーを保存</button>
      <button className="secondary-button" disabled={busy || !apiConfigured} onClick={upload}>この端末 → D1</button>
      <button className="primary-button" disabled={busy || !apiConfigured} onClick={download}>D1 → この端末</button>
    </div>
    <div className="sync-footer"><small>{busy ? '同期処理中…' : status}</small><button onClick={forget}>キーを忘れる</button></div>
    <small className="sync-note">D1保存は最後に確認したリモート版と一致する時だけ成功します。別端末で更新されていた場合は上書きを止めるので、先に「D1 → この端末」で最新版を確認してください。D1から戻す状態も候補URL・関係性・日時などを検証してから端末へ反映します。同じキーでAI/検索・X・Instagramの保護ルートも認証します。</small>
  </section>;
}
