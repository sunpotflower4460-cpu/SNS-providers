import { useEffect, useState } from 'react';
import { apiConfigured } from './api';
import { disconnectXOAuth, fetchXOAuthStatus, startXOAuth, type XOAuthStatus } from './xAccount';
import './xAccount.css';

const emptyStatus: XOAuthStatus = {
  configured: false,
  connected: false,
  scopes: [],
  expiresAt: null,
  updatedAt: null,
};

export default function XAccountControls() {
  const [status, setStatus] = useState<XOAuthStatus>(emptyStatus);
  const [loading, setLoading] = useState(apiConfigured);
  const [note, setNote] = useState(apiConfigured ? '接続状態を確認中…' : 'Worker未接続');

  useEffect(() => {
    if (!apiConfigured) return;
    let cancelled = false;
    fetchXOAuthStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setNote(next.connected ? '読み取り専用で接続済み' : next.configured ? '接続できます' : 'Worker側のX OAuth設定が未完了です');
      })
      .catch((error) => {
        if (!cancelled) setNote(error instanceof Error ? error.message : '接続状態の確認に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function disconnect() {
    setLoading(true);
    try {
      await disconnectXOAuth();
      setStatus((current) => ({ ...current, connected: false, expiresAt: null, updatedAt: null }));
      setNote('Worker内のX接続トークンを削除しました');
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'X接続解除に失敗しました');
    } finally {
      setLoading(false);
    }
  }

  return <section className="form-card x-account-card">
    <div className="field-title">
      <div><strong>Xアカウント</strong><span>自分の投稿・フォロー関係を将来自動分析するための読み取り接続</span></div>
      <b className={status.connected ? 'connected' : ''}>{status.connected ? 'READ' : 'X'}</b>
    </div>

    <div className="x-scope-note">
      <strong>書き込み権限は要求しません</strong>
      <span>`tweet.read` / `users.read` / `follows.read` / `offline.access` のみ。フォロー・解除・投稿・DM送信権限は取りません。</span>
    </div>

    {status.connected && <div className="x-connection-details">
      <span><b>状態</b> 接続済み</span>
      <span><b>Scopes</b> {status.scopes.join(' · ') || 'read-only'}</span>
      {status.updatedAt && <span><b>更新</b> {new Date(status.updatedAt).toLocaleString('ja-JP')}</span>}
    </div>}

    <div className="x-account-actions">
      {!status.connected
        ? <button className="primary-button" disabled={loading || !apiConfigured || !status.configured} onClick={() => startXOAuth()}>{loading ? '確認中…' : 'Xを読み取り専用で接続'}</button>
        : <button className="secondary-button" disabled={loading} onClick={disconnect}>{loading ? '処理中…' : 'この端末/Workerの接続を外す'}</button>}
    </div>
    <small>{note}</small>
    <small className="x-account-warning">この「接続解除」はWorkerに保存したtokenを削除します。X側のアプリ許可そのものを完全に取り消したい場合は、Xの連携アプリ設定からも取り消してください。</small>
  </section>;
}
