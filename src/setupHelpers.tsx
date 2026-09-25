import { useState } from 'react';
import { apiBaseUrl, apiConfigured, fetchBudget } from './api';
import { getSyncToken, setSyncToken } from './controlToken';

/** One value the user pastes into another service, with a copy button. */
export function CopyField({ label, value, secret = false, note }: { label: string; value: string; secret?: boolean; note?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle');
  const [shown, setShown] = useState(!secret);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState('done');
    } catch {
      setState('error');
    }
    window.setTimeout(() => setState('idle'), 1_800);
  }
  return <div className="copy-field">
    <span className="copy-field-label">{label}</span>
    <code>{shown ? value : '••••••••••••••••'}</code>
    <div className="copy-field-actions">
      {secret && <button type="button" onClick={() => setShown((current) => !current)}>{shown ? '隠す' : '表示'}</button>}
      <button type="button" className="is-primary" onClick={() => void copy()}>{state === 'done' ? 'コピーしました' : state === 'error' ? 'コピー失敗' : 'コピー'}</button>
    </div>
    {note && <small>{note}</small>}
  </div>;
}

export function appUrl() {
  const base = import.meta.env.BASE_URL || '/';
  return `${window.location.origin}${base.startsWith('/') ? base : `/${base}`}`;
}

export function serverUrl() {
  return apiConfigured ? apiBaseUrl : 'https://social-mission-api.（あなたの名前）.workers.dev';
}

export function xCallbackUrl() {
  return `${serverUrl()}/api/x/oauth/callback`;
}

function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Creates the personal key and its SHA-256 in the browser so no terminal is needed.
 * The raw key is saved only on this device after the Worker accepts it.
 */
export function PersonalKeyMaker() {
  const [key, setKey] = useState('');
  const [hash, setHash] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const hasSaved = Boolean(getSyncToken().trim());

  async function generate() {
    const raw = base64(randomBytes(32)).replace(/[+/=]/g, '').slice(0, 40);
    setKey(raw);
    setHash(await sha256Hex(raw));
    setNote('');
  }

  async function save() {
    if (!key) return;
    setBusy(true);
    try {
      if (apiConfigured) {
        await fetchBudget('local-user', key);
        setSyncToken(key);
        setNote('✓ サーバーで確認でき、この端末に保存しました。');
      } else {
        setSyncToken(key);
        setNote('この端末に保存しました。サーバーをつないだあと自動で確認されます。');
      }
    } catch (error) {
      setNote(`まだ確認できません: ${error instanceof Error ? error.message : '不明なエラー'}。ハッシュをCloudflareに保存したか、保存後1分ほど待ってから、もう一度押してください。`);
    } finally {
      setBusy(false);
    }
  }

  return <div className="setup-helper">
    {hasSaved && !key && <p className="setup-helper-note">この端末にはキーが保存済みです。作り直す必要はありません。</p>}
    <button type="button" className="secondary-button" onClick={() => void generate()}>{key ? 'キーを作り直す' : 'キーを自動で作る'}</button>
    {key && <>
      <CopyField label="① 個人管理キー（あなたが控えておくもの）" value={key} secret note="パスワード管理アプリなどに保存してください。別の端末で使うときに必要です。" />
      <CopyField label="② Cloudflareに登録する値（名前: SYNC_TOKEN_SHA256）" value={hash} note="Cloudflare → social-mission-api → 設定 → 変数とシークレット →「追加」→ 種類「シークレット」で登録します。" />
      <button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? '確認中…' : '③ 登録したので、この端末に保存する'}</button>
    </>}
    {note && <p className="setup-helper-note" role="status">{note}</p>}
  </div>;
}

/** Everything the X Developer Console and Cloudflare ask for, prefilled for this app. */
export function XSetupValues() {
  const [encryptionKey, setEncryptionKey] = useState('');
  return <div className="setup-helper">
    <p className="setup-helper-title">X Developer Console に入力する値</p>
    <CopyField label="コールバックURI / リダイレクトURL" value={xCallbackUrl()} note={apiConfigured ? '1文字でも違うとログインに失敗します。コピーして貼ってください。' : 'サーバーをつなぐと、ここに実際のURLが表示されます。'} />
    <CopyField label="ウェブサイトURL" value={appUrl()} />
    <p className="setup-helper-title">Cloudflare（social-mission-api）に登録する値</p>
    <CopyField label="X_OAUTH_CALLBACK_URL" value={xCallbackUrl()} />
    <CopyField label="PWA_RETURN_URL" value={appUrl()} note="ログイン後にこのアプリへ戻ってくる場所です。" />
    {encryptionKey
      ? <CopyField label="OAUTH_TOKEN_ENCRYPTION_KEY_B64" value={encryptionKey} secret note="Xのログイン情報を暗号化する鍵です。一度登録したら変えないでください（変えるとXの再接続が必要）。" />
      : <button type="button" className="secondary-button" onClick={() => setEncryptionKey(base64(randomBytes(32)))}>OAUTH_TOKEN_ENCRYPTION_KEY_B64 を自動で作る</button>}
    <p className="setup-helper-note">X_CLIENT_ID と X_CLIENT_SECRET は、X Developer Console のアプリの「キーとトークン」画面にあります（Client Secret は作成時に一度しか表示されません）。</p>
  </div>;
}

interface PriceRow { name: string; value: string; what: string }

const X_READ_ROWS: PriceRow[] = [
  { name: 'X_OWNED_READ_ELIGIBLE', value: 'true', what: '自分のアカウントのデータ（投稿・フォロワー・フォロー中）を読む許可' },
  { name: 'X_OWNED_READ_USD', value: '0.001', what: '自分のデータ1件あたりの料金（Owned Reads）' },
  { name: 'X_USER_READ_USD', value: '0.01', what: 'プロフィール1件あたりの料金' },
  { name: 'X_LOOKUP_READ_USD', value: '0.01', what: '送信前の本人確認1回あたりの料金' },
  { name: 'X_INBOUND_SYNC_ENABLED', value: 'true', what: 'メンション・返信を「今日」へ取り込む' },
  { name: 'X_INBOUND_READ_USD', value: '0.05', what: '取り込み1回あたりの見積もり（新着約10件分）' },
];

const X_WRITE_ROWS: PriceRow[] = [
  { name: 'SOCIAL_WRITE_ENABLED', value: 'true', what: 'アプリからの送信を全体でオンにする' },
  { name: 'X_REPLY_WRITE_ENABLED', value: 'true', what: 'Xへの返信をオンにする' },
  { name: 'X_REPLY_WRITE_USD', value: '0.015', what: '返信1件の料金（URLを含む返信はアプリから送りません）' },
];

const X_DM_ROWS: PriceRow[] = [
  { name: 'X_DM_READ_ENABLED', value: 'true', what: 'DMの取り込みをオンにする' },
  { name: 'X_DM_READ_USD', value: '0.05', what: 'DM取り込み1回あたりの見積もり' },
  { name: 'X_DM_WRITE_ENABLED', value: 'true', what: 'DMの返信をオンにする' },
  { name: 'X_DM_WRITE_USD', value: '0.015', what: 'DM送信1件の見積もり' },
];

export function XPriceTable({ kind }: { kind: 'read' | 'write' | 'dm' }) {
  const rows = kind === 'read' ? X_READ_ROWS : kind === 'write' ? X_WRITE_ROWS : X_DM_ROWS;
  return <div className="setup-helper">
    <table className="setup-values">
      <thead><tr><th>名前</th><th>値</th><th>意味</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.name}><td><code>{row.name}</code></td><td><code>{row.value}</code></td><td>{row.what}</td></tr>)}</tbody>
    </table>
    <CopyField label="まとめてコピー（メモ用）" value={rows.map((row) => `${row.name}=${row.value}`).join('\n')} />
    <p className="setup-helper-note">料金は2026年9月時点の目安です。X Developer Console の「料金 / Pricing」で最新の値を確認し、違っていたら大きい方の値を入れてください。料金を入れない操作は、安全のため実行されません。</p>
  </div>;
}
