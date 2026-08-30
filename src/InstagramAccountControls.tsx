import { useState } from 'react';
import { apiConfigured, fetchSocialCapabilities, syncInstagramDirectMessages } from './api';
import { applyInstagramDmEvents } from './dmInboundStore';
import { setLiveSocialCapabilities, getLiveSocialCapabilities } from './socialCapabilities';
import { syncInstagramEngagers } from './instagramAccount';
import { applyInstagramEngagers } from './instagramOwnedStore';
import type { AppState, AppStateUpdater } from './types';
import './instagramAccount.css';

export default function InstagramAccountControls({ state, onChange }: { state: AppState; onChange: AppStateUpdater }) {
  const [syncing, setSyncing] = useState(false);
  const [dmSyncing, setDmSyncing] = useState(false);
  const [probing, setProbing] = useState(false);
  const [note, setNote] = useState(apiConfigured ? 'Instagram Professionalアカウントを設定すると使えます' : 'Instagram接続はまだ利用できません');
  const caps = getLiveSocialCapabilities()?.instagram;

  async function refreshCapabilities() {
    setProbing(true);
    try {
      const snapshot = await fetchSocialCapabilities();
      setLiveSocialCapabilities(snapshot);
      const ig = snapshot.instagram;
      if (ig.tokenValid === false) {
        setNote(ig.reason || 'トークンの期限切れまたは無効です。権限不足ではなく、Meta側でトークンを再発行してください。');
      } else if (ig.permissionsVerified) {
        setNote(`権限を確認しました。コメント${ig.readComments ? '取得可' : '未許可'} · DM${ig.readDm ? '取得可' : '未許可'}`);
      } else {
        setNote(ig.reason || 'トークンは通っていますが、コメント/DM権限が確認できません。App Review と permission を確認してください。');
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : '権限状態を確認できませんでした');
    } finally {
      setProbing(false);
    }
  }

  async function sync() {
    setSyncing(true);
    setNote('自分の投稿にコメントしてくれた人を確認しています…');
    try {
      const result = await syncInstagramEngagers();
      if (!result.enabled) {
        setNote(result.reason || '現在はInstagramのコメント反応を同期できません');
        return;
      }
      onChange((current) => applyInstagramEngagers(current, result));
      try {
        setLiveSocialCapabilities(await fetchSocialCapabilities());
      } catch {
        // Capability refresh is best-effort; execute still fail-closes on the Worker.
      }
      const source = result.source === 'cache' ? '保存済みデータ' : 'Instagram公式データ';
      setNote(`${source}から更新しました · 反応してくれた人 ${result.engagers.length}人 · $0`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Instagramの情報を更新できませんでした');
    } finally {
      setSyncing(false);
    }
  }

  async function syncDm() {
    setDmSyncing(true);
    setNote('InstagramのDMを確認しています…');
    try {
      const result = await syncInstagramDirectMessages('local-user', state.budget.monthlyLimitUsd);
      if (!result.enabled) {
        setNote(result.reason || 'Instagram DMを同期できません');
        return;
      }
      onChange((current) => applyInstagramDmEvents(current, Array.isArray(result.events) ? result.events as never : []));
      setNote(`Instagram DM ${Array.isArray(result.events) ? result.events.length : 0}件を取り込みました`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Instagram DMを更新できませんでした');
    } finally {
      setDmSyncing(false);
    }
  }

  return <section className="form-card instagram-account-card">
    <div className="field-title">
      <div><strong>Instagramの反応を取り込む</strong><span>すでにコメントしてくれた人を、優先度の高い交流候補へ反映します</span></div>
      <b>IG</b>
    </div>
    <div className="instagram-source-note">
      <strong>自分の投稿へのコメントと、届いているDMだけを読み取ります</strong>
      <span>コメント返信とDM返信は、Workerが実際の接続・権限・書き込みフラグを確認できたときだけアプリ内送信できます。一般フォロー/任意いいねは公式APIがないためHANDOFFです。勝手に巡回したり、承認なしで送信したりはしません。</span>
    </div>
    {caps && <div className="x-capability-list" aria-label="Instagramの接続権限">
      <span>{caps.readComments ? '✓ コメント取得 許可' : '− コメント取得 未許可'}</span>
      <span>{caps.sendCommentReply ? '✓ コメント返信 許可' : '− コメント返信 未許可'}</span>
      <span>{caps.readDm ? '✓ DM取得 許可' : '− DM取得 未許可'}</span>
      <span>{caps.sendDm ? '✓ DM返信 許可' : '− DM返信 未許可'}</span>
    </div>}
    {state.instagramAccount?.lastSyncedAt && <div className="instagram-sync-summary">
      <span><b>{state.instagramAccount.mediaScanned || 0}</b> 投稿を確認</span>
      <span><b>{state.instagramAccount.commentEvents || 0}</b> コメント</span>
      <span><b>{state.instagramAccount.engagerCount || 0}</b> 反応した人</span>
    </div>}
    <button className="primary-button" disabled={syncing || !apiConfigured} onClick={sync}>{syncing ? '更新中…' : 'コメント反応を更新'}</button>
    <button className="secondary-button" disabled={dmSyncing || !apiConfigured} onClick={syncDm}>{dmSyncing ? 'DM確認中…' : 'DMを取り込む'}</button>
    <button className="secondary-button" disabled={probing || !apiConfigured} onClick={() => void refreshCapabilities()}>{probing ? '確認中…' : '権限状態を確認'}</button>
    <small>{note}</small>
    <details className="candidate-details">
      <summary>接続に必要なもの</summary>
      <div className="candidate-details-body strategy-note"><p>Instagram Professionalアカウントのアクセストークン・ユーザーID・APIバージョンをサーバー側へ設定します。権限確認は推測せず、公式のpermissions endpointで fail closed します。同じ内容を何度も取りに行かないよう、12時間以内は保存済みデータを優先します。</p></div>
    </details>
  </section>;
}
