import { useRef, useState } from 'react';
import { downloadBackup, readBackup } from './backup';
import InstallControls from './InstallControls';
import InstagramAccountControls from './InstagramAccountControls';
import SyncControls from './SyncControls';
import WorkloadControls from './WorkloadControls';
import XAccountControls from './XAccountControls';
import type { AppState, AppStateUpdater } from './types';

export default function BackupControls({ state, onRestore }: { state: AppState; onRestore: (state: AppState) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const latestStateRef = useRef(state);
  latestStateRef.current = state;
  const [status, setStatus] = useState('');

  // Settings currently exposes a plain state callback. Adapt nested controls to a
  // functional updater and advance the ref immediately, not only on the next render.
  // This serializes two async completions that land in the same render window.
  const updateState: AppStateUpdater = (value) => {
    const next = typeof value === 'function' ? value(latestStateRef.current) : value;
    latestStateRef.current = next;
    onRestore(next);
  };

  async function restore(file?: File) {
    if (!file) return;
    try {
      const restored = await readBackup(file);
      updateState(restored);
      setStatus('復元しました');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '復元に失敗しました');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return <div className="settings-groups">
    <details className="settings-group">
      <summary>
        <span><strong>1日の量を調整</strong><small>Todayに出す件数や自動補充を細かく変えたいとき</small></span>
        <b>⌄</b>
      </summary>
      <div className="settings-group-body"><WorkloadControls state={state} onChange={(next) => updateState(next)} /></div>
    </details>

    <details className="settings-group">
      <summary>
        <span><strong>アプリ・SNS・クラウド接続</strong><small>初期設定や端末を変えるときだけ使います</small></span>
        <b>⌄</b>
      </summary>
      <div className="settings-group-body advanced-stack">
        <InstallControls />
        <SyncControls state={state} onRestore={updateState} />
        <XAccountControls state={state} onChange={updateState} />
        <InstagramAccountControls state={state} onChange={updateState} />
      </div>
    </details>

    <details className="settings-group">
      <summary>
        <span><strong>バックアップ</strong><small>ローカルデータを書き出す・復元する</small></span>
        <b>⌄</b>
      </summary>
      <div className="settings-group-body">
        <section className="form-card backup-card">
          <div className="field-title"><div><strong>ローカルデータ</strong><span>Mission・候補・関係性・設定をJSONで持ち運びます</span></div><b>JSON</b></div>
          <div className="backup-actions">
            <button className="secondary-button" onClick={() => { downloadBackup(state); setStatus('バックアップを書き出しました'); }}>バックアップを書き出す</button>
            <button className="secondary-button" onClick={() => inputRef.current?.click()}>バックアップを復元</button>
          </div>
          <input ref={inputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => restore(event.target.files?.[0])} />
          <small>{status || 'APIキー・SNSパスワード・個人管理キーはバックアップに含まれません。'}</small>
        </section>
      </div>
    </details>
  </div>;
}
