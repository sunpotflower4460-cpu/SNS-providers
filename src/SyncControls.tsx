import { useEffect, useRef, useState } from 'react';
import { apiConfigured, fetchBudget } from './api';
import { normalizeAppState, validateAppState } from './backup';
import { detachExternalAccountSummaries } from './restoreSafety';
import { clearRemoteStateVersion, clearSyncToken, downloadRemoteState, getRemoteStateVersion, getSyncToken, setSyncToken, uploadRemoteState } from './sync';
import { syncBudget } from './store';
import type { AppState, AppStateUpdater } from './types';
import './sync.css';

export default function SyncControls({ state, onRestore }: { state: AppState; onRestore: AppStateUpdater }) {
  const [token, setToken] = useState(() => getSyncToken());
  const [status, setStatus] = useState(apiConfigured ? 'まだ同期していません' : 'クラウド接続は未設定です');
  const [busy, setBusy] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const latestStateRef = useRef(state);

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

  async function saveToken() {
    const previous = getSyncToken().trim();
    const next = token.trim();
    if (!next) {
      const tokenCleared = clearSyncToken();
      const versionCleared = clearRemoteStateVersion();
      setStatus(tokenCleared && versionCleared
        ? 'この端末から個人管理キーを削除しました'
        : 'この画面ではキーを削除しましたが、ブラウザの保存領域から消せませんでした。ストレージ設定を確認してください。');
      return;
    }
    if (!apiConfigured) {
      const versionCleared = previous === next ? true : clearRemoteStateVersion();
      const tokenPersisted = setSyncToken(next);
      setStatus(tokenPersisted && versionCleared
        ? '個人管理キーをこの端末に保存しました。クラウド接続はまだ未設定です'
        : 'この画面ではキーを使えますが、端末への保存に失敗しました。クラウド接続もまだ未設定です');
      return;
    }

    setBusy(true);
    setStatus('個人管理キーが正しいか確認しています…');
    try {
      // Validate the candidate token directly. Do not stage an unverified replacement in
      // localStorage and then attempt a rollback if the Worker rejects it.
      const budget = await fetchBudget('local-user', next);
      const versionCleared = previous === next ? true : clearRemoteStateVersion();
      const tokenPersisted = setSyncToken(next);
      onRestore((current) => syncBudget(current, budget.usedUsd, budget.limitUsd));
      setStatus(tokenPersisted && versionCleared
        ? '個人管理キーを保存し、クラウド接続を確認しました'
        : 'クラウド接続は確認できましたが、この端末へのキーまたは同期情報の保存に失敗しました');
    } catch (error) {
      setToken(previous);
      const message = error instanceof Error ? error.message : '個人管理キーを確認できませんでした';
      setStatus(`${message} · 変更は保存していません`);
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    const localFingerprintAtStart = stateFingerprint(latestStateRef.current);
    setBusy(true);
    try {
      const previous = getSyncToken().trim();
      const next = token.trim();
      const expectedVersion = previous === next ? getRemoteStateVersion() : null;
      const result = await uploadRemoteState(latestStateRef.current, next, 'local-user', expectedVersion);
      const tokenPersisted = setSyncToken(next);
      const changedWhileSaving = stateFingerprint(latestStateRef.current) !== localFingerprintAtStart;
      const persistenceWarning = tokenPersisted && result.versionPersisted
        ? ''
        : ' · クラウド保存は成功しましたが、この端末に同期情報を残せませんでした。再読み込み前にストレージ設定を確認してください';
      const freshnessWarning = changedWhileSaving
        ? ' · 保存中にこの端末のデータが更新されました。最新分を反映するにはもう一度保存してください'
        : '';
      setStatus(`クラウドへ保存しました · ${new Date(result.updatedAt).toLocaleString('ja-JP')}${persistenceWarning}${freshnessWarning}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'クラウドへの保存に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    const localFingerprintAtStart = stateFingerprint(latestStateRef.current);
    setBusy(true);
    try {
      const next = token.trim();
      const result = await downloadRemoteState(next);
      const tokenPersisted = setSyncToken(next);
      const persistenceWarning = tokenPersisted && result.versionPersisted
        ? ''
        : ' · この画面では利用できますが、この端末に同期情報を保存できませんでした';
      if (!result.found || !result.state) {
        setStatus(`クラウドに保存済みデータはありません${persistenceWarning}`);
        return;
      }

      // A remote download can take long enough for Today, X/Instagram sync, or another
      // local edit to finish meanwhile. Replacing state after that would silently erase
      // the newer local work. Abort the restore and clear the optimistic version that the
      // download learned, so a later upload cannot overwrite remote data without a fresh
      // download/restore decision.
      if (stateFingerprint(latestStateRef.current) !== localFingerprintAtStart) {
        const versionCleared = clearRemoteStateVersion();
        setStatus(`復元中にこの端末のデータが変更されたため、上書きせず停止しました。もう一度「クラウドから復元」を実行してください${tokenPersisted && versionCleared ? '' : ' · 端末の同期情報を完全に保存できないためストレージ設定も確認してください'}`);
        return;
      }

      const restored = detachExternalAccountSummaries(normalizeAppState(result.state));
      validateAppState(restored);
      onRestore(restored);
      // Snapshot budget totals can lag the live HARD LIMIT ledger. Reconcile from the
      // Worker after restore so the UI and client paid ceilings match current spend.
      try {
        const budget = await fetchBudget('local-user', next);
        onRestore((current) => syncBudget(current, budget.usedUsd, budget.limitUsd));
        setStatus(`クラウドのデータを確認して復元し、利用額も最新化しました · ${result.updatedAt ? new Date(result.updatedAt).toLocaleString('ja-JP') : '日時不明'} · SNSアカウントの現在情報は次回の公式同期で更新します${persistenceWarning}`);
      } catch {
        setStatus(`クラウドのデータを確認して復元しました · ${result.updatedAt ? new Date(result.updatedAt).toLocaleString('ja-JP') : '日時不明'} · 利用額の再取得は後でキー確認時に更新します · SNSアカウントの現在情報は次回の公式同期で更新します${persistenceWarning}`);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'クラウドからの復元に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  function forget() {
    const tokenCleared = clearSyncToken();
    const versionCleared = clearRemoteStateVersion();
    setToken('');
    setShowToken(false);
    setStatus(tokenCleared && versionCleared
      ? 'この端末の個人管理キーと同期情報を削除しました'
      : 'この画面ではキーを忘れましたが、ブラウザの保存領域から削除できませんでした。ストレージ設定を確認してください。');
  }

  return <section className="form-card sync-card">
    <div className="field-title"><div><strong>PC・スマホ間でデータを引き継ぐ</strong><span>Mission・候補・関係の記録を自分の端末間で同期します</span></div><b>同期</b></div>
    <label>個人管理キー
      <div className="secret-field">
        <input disabled={busy} type={showToken ? 'text' : 'password'} autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="自分で設定した個人管理キー" />
        <button type="button" disabled={busy} aria-pressed={showToken} aria-label={showToken ? '個人管理キーを隠す' : '個人管理キーを表示'} onClick={() => setShowToken((current) => !current)}>{showToken ? '隠す' : '表示'}</button>
      </div>
    </label>
    <small className="sync-note">個人管理キーは、他の人があなたのクラウドデータやSNS接続へ触れないためのパスワードのようなものです。</small>
    <div className="sync-actions">
      <button className="secondary-button" disabled={busy} onClick={saveToken}>キーを確認・保存</button>
      <button className="secondary-button" disabled={busy || !apiConfigured} onClick={upload}>この端末のデータを保存</button>
      <button className="primary-button" disabled={busy || !apiConfigured} onClick={download}>クラウドから復元</button>
    </div>
    <div className="sync-footer"><small aria-live="polite">{busy ? '処理中…' : status}</small><button disabled={busy} onClick={forget}>この端末からキーを削除</button></div>
    <small className="sync-note">別の端末に新しいデータがあるときは、古い状態で上書きしないよう自動で停止します。その場合は先に「クラウドから復元」で最新版を取り込んでください。復元データも安全性を確認してから反映します。</small>
  </section>;
}

function stateFingerprint(state: AppState) {
  return JSON.stringify(normalizeAppState(state));
}
