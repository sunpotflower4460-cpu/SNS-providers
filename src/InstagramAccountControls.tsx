import { useState } from 'react';
import { apiConfigured } from './api';
import { syncInstagramEngagers } from './instagramAccount';
import { applyInstagramEngagers } from './instagramOwnedStore';
import type { AppState, AppStateUpdater } from './types';
import './instagramAccount.css';

export default function InstagramAccountControls({ state, onChange }: { state: AppState; onChange: AppStateUpdater }) {
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState(apiConfigured ? 'Instagram Professionalアカウントを設定すると使えます' : 'Instagram接続はまだ利用できません');

  async function sync() {
    setSyncing(true);
    setNote('自分の投稿にコメントしてくれた人を確認しています…');
    try {
      const result = await syncInstagramEngagers();
      if (!result.enabled) {
        setNote(result.reason || '現在はInstagramのコメント反応を同期できません');
        return;
      }
      // Preserve edits made elsewhere while the network request was running.
      onChange((current) => applyInstagramEngagers(current, result));
      const source = result.source === 'cache' ? '保存済みデータ' : 'Instagram公式データ';
      setNote(`${source}から更新しました · 反応してくれた人 ${result.engagers.length}人 · $0`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Instagramの情報を更新できませんでした');
    } finally {
      setSyncing(false);
    }
  }

  return <section className="form-card instagram-account-card">
    <div className="field-title">
      <div><strong>Instagramの反応を取り込む</strong><span>すでにコメントしてくれた人を、優先度の高い交流候補へ反映します</span></div>
      <b>IG</b>
    </div>
    <div className="instagram-source-note">
      <strong>自分の投稿へのコメントだけを読み取ります</strong>
      <span>コメント返信は公式APIが許可する範囲でアプリ内実行の対象です。フォローは公式プロフィールへのHANDOFFのままです。勝手に巡回したり、承認なしで送信したりはしません。</span>
    </div>
    {state.instagramAccount?.lastSyncedAt && <div className="instagram-sync-summary">
      <span><b>{state.instagramAccount.mediaScanned || 0}</b> 投稿を確認</span>
      <span><b>{state.instagramAccount.commentEvents || 0}</b> コメント</span>
      <span><b>{state.instagramAccount.engagerCount || 0}</b> 反応した人</span>
    </div>}
    <button className="primary-button" disabled={syncing || !apiConfigured} onClick={sync}>{syncing ? '更新中…' : 'コメント反応を更新'}</button>
    <small>{note}</small>
    <details className="candidate-details">
      <summary>接続に必要なもの</summary>
      <div className="candidate-details-body strategy-note"><p>Instagram Professionalアカウントのアクセストークン・ユーザーID・APIバージョンをサーバー側へ設定します。同じ内容を何度も取りに行かないよう、12時間以内は保存済みデータを優先します。</p></div>
    </details>
  </section>;
}
