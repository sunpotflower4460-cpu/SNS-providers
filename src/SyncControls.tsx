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
    setStatus(token.trim() ? '同期キーをこの端末に保存しました' : '同期キーを削除しました');
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
    setStatus('この端末の同期キーを削除しました');
  }

  return <section className="form-card sync-card">
    <div className="field-title"><div><strong>個人D1同期</strong><span>別端末へMission・候補・関係性を引き継ぐ</span></div><b>SYNC</b></div>
    <label>同期キー<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Worker側のSHA-256元キー" /></label>
    <div className="sync-actions">
      <button className="secondary-button" disabled={busy || !apiConfigured} onClick={saveToken}>キーを保存</button>
      <button className="secondary-button" disabled={busy || !apiConfigured} onClick={upload}>この端末 → D1</button>
      <button className="primary-button" disabled={busy || !apiConfigured} onClick={download}>D1 → この端末</button>
    </div>
    <div className="sync-footer"><small>{busy ? '同期処理中…' : status}</small><button onClick={forget}>キーを忘れる</button></div>
    <small className="sync-note">同期キーそのものはD1やバックアップJSONへ保存しません。D1上の状態データは暗号化ではなくアクセス制御されたスナップショットです。</small>
  </section>;
}
