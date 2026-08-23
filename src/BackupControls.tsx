import { useRef, useState } from 'react';
import { downloadBackup, readBackup } from './backup';
import InstallControls from './InstallControls';
import InstagramAccountControls from './InstagramAccountControls';
import SyncControls from './SyncControls';
import WorkloadControls from './WorkloadControls';
import XAccountControls from './XAccountControls';
import type { AppState, AppStateUpdater } from './types';

export default function BackupControls({ state, onRestore }: { state: AppState; onRestore: AppStateUpdater }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('');

  async function restore(file?: File) {
    if (!file) return;
    try {
      const restored = await readBackup(file);
      onRestore(restored);
      setStatus('復元しました');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '復元に失敗しました');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return <>
    <InstallControls />
    <WorkloadControls state={state} onChange={onRestore} />
    <SyncControls state={state} onRestore={onRestore} />
    <XAccountControls state={state} onChange={onRestore} />
    <InstagramAccountControls state={state} onChange={onRestore} />
    <section className="form-card backup-card">
      <div className="field-title"><div><strong>ローカルデータ</strong><span>Mission・候補・関係性・設定を持ち運ぶ</span></div><b>JSON</b></div>
      <div className="backup-actions">
        <button className="secondary-button" onClick={() => { downloadBackup(state); setStatus('バックアップを書き出しました'); }}>バックアップを書き出す</button>
        <button className="secondary-button" onClick={() => inputRef.current?.click()}>バックアップを復元</button>
      </div>
      <input ref={inputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={(event) => restore(event.target.files?.[0])} />
      <small>{status || 'APIキー・SNSパスワード・個人管理キーはバックアップに含まれません。'}</small>
    </section>
  </>;
}
