import { useState } from 'react';
import { apiConfigured } from './api';
import { clearSyncToken, downloadRemoteState, getSyncToken, setSyncToken, uploadRemoteState } from './sync';
import type { AppState } from './types';
import './sync.css';

export default function SyncControls({ state, onRestore }: { state: AppState; onRestore: (state: AppState) => void }) {
  const [token, setToken] = useState(() => getSyncToken());
  const [status, setStatus] = useState(apiConfigured ? '未同期' : 'Worker未接続');
  const [busy, setBusy] = useState(false);

  function saveToken() {
    setSyncToken(token);
    setStatus(token.trim() ? '個人管理キーをこの端末に保存しました' : '個人管理キーを削除しました');
  }

  async function upload() {
    setBusy(true);
    try {
      setSyncToken(token);
      const result = await uploadRemoteState(state, token);
      setStatus(`D1へ保存 · ${new Date(result.updatedAt).toLocaleString('ja-JP')}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '同期アップロードに失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    setBusy(true);
    try {
      setSyncToken(token);
      const result = await downloadRemoteState(token);
      if (!result.found || !result.state) {
        setStatus('D1に保存済みデータはありません');
        return;
      }
      onRestore(result.state);
      setStatus(`D1から復元 · ${result.updatedAt ? new Date(result.updatedAt).toLocaleString('ja-JP') : '日時不明'}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '同期ダウンロードに失敗しました');
    } finally {
      setBusy(false);
    }
  }

  function forget() {
    clearSyncToken();
    setToken('');
    setStatus('この端末の個人管理キーを削除しました');
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
    <small className="sync-note">同じキーでX OAuthの開始/解除とX owned-read同期も保護します。生キーはD1やバックアップJSONへ保存せず、この端末のlocalStorageだけに保持します。</small>
  </section>;
}
