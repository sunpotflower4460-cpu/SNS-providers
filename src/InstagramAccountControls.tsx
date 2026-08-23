import { useState } from 'react';
import { apiConfigured } from './api';
import { syncInstagramEngagers } from './instagramAccount';
import { applyInstagramEngagers } from './instagramOwnedStore';
import type { AppState, AppStateUpdater } from './types';
import './instagramAccount.css';

export default function InstagramAccountControls({ state, onChange }: { state: AppState; onChange: AppStateUpdater }) {
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState(apiConfigured ? 'Professionalアカウント連携はWorker設定後に利用できます' : 'Worker未接続');

  async function sync() {
    setSyncing(true);
    setNote('自分の投稿にコメントしてくれた人を公式APIから確認中…');
    try {
      const result = await syncInstagramEngagers();
      if (!result.enabled) {
        setNote(result.reason || 'Instagramコメント同期は現在無効です');
        return;
      }
      // Preserve edits made elsewhere while the network request was running.
      onChange((current) => applyInstagramEngagers(current, result));
      const source = result.source === 'cache' ? 'キャッシュ' : 'Instagram公式API';
      setNote(`${source}から同期 · 反応者${result.engagers.length}人 · $0`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Instagram同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  }

  return <section className="form-card instagram-account-card">
    <div className="field-title">
      <div><strong>Instagram反応者</strong><span>自分へ既にコメントしてくれた人を高品質な交流候補へ</span></div>
      <b>IG</b>
    </div>
    <div className="instagram-source-note">
      <strong>Professionalアカウントの公式APIのみ</strong>
      <span>自分の投稿コメントを読み、commenterのusernameを候補化します。Instagram全体の自動巡回・スクレイピングは行いません。</span>
    </div>
    {state.instagramAccount?.lastSyncedAt && <div className="instagram-sync-summary">
      <span><b>{state.instagramAccount.mediaScanned || 0}</b> posts</span>
      <span><b>{state.instagramAccount.commentEvents || 0}</b> comments</span>
      <span><b>{state.instagramAccount.engagerCount || 0}</b> people</span>
    </div>}
    <button className="primary-button" disabled={syncing || !apiConfigured} onClick={sync}>{syncing ? '同期中…' : 'コメント反応者を同期'}</button>
    <small>{note}</small>
    <small className="instagram-account-warning">利用にはWorker側へInstagram Professionalアカウントのaccess token / user ID / API versionを設定します。12時間以内はD1キャッシュを優先します。</small>
  </section>;
}
