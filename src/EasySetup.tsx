import { useEffect, useRef, useState, type FormEvent } from 'react';
import { type ConnectionStatus, xReadConnectAvailable } from './connectionStatus';
import { syncBudget } from './store';
import { verifyAndSaveControlToken } from './sync';
import type { AppStateUpdater } from './types';
import { useModalA11y } from './useModalA11y';
import XReadConnectButton from './XReadConnectButton';
import './easySetup.css';

export const OPEN_EASY_SETUP_EVENT = 'sns-providers:open-easy-setup';

export function openEasySetup() {
  window.dispatchEvent(new Event(OPEN_EASY_SETUP_EVENT));
}

const titles = {
  local: '今すぐ使えます',
  checking: '使う準備を確認しています',
  retry: 'つながりを確認できませんでした',
  key: 'アプリの鍵を入れる',
  x: 'X（旧Twitter）をつなぎますか？',
  ready: '準備ができました',
};

function setupStage(status: ConnectionStatus): keyof typeof titles {
  if (status.server === 'todo') return 'local';
  if (status.checking || status.reachable === 'unknown') return 'checking';
  if (status.reachable !== 'ready') return 'retry';
  if (status.key === 'todo') return 'key';
  if (status.error) return 'retry';
  return xReadConnectAvailable(status) ? 'x' : 'ready';
}

export default function EasySetup({ status, onRetry, onToday, onClose, onChange }: {
  status: ConnectionStatus;
  onRetry: () => void;
  onToday: () => void;
  onClose: () => void;
  onChange: AppStateUpdater;
}) {
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const stage = saving ? 'checking' : setupStage(status);
  const headingRef = useRef<HTMLHeadingElement>(null);

  function dismiss() {
    if (!saving) onClose();
  }

  const containerRef = useModalA11y<HTMLElement>(dismiss, 'dialog');
  useEffect(() => { headingRef.current?.focus(); }, [stage]);

  async function submitKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      let candidate = key.trim();
      if (!candidate) {
        candidate = (await navigator.clipboard?.readText?.().catch(() => ''))?.trim() || '';
        if (!candidate) {
          setError('入力欄を長く押して「ペースト」または「貼り付け」を選んでください。');
          return;
        }
      }
      if (candidate.length > 512) {
        setError('鍵をコピーし直してから、もう一度お試しください。');
        return;
      }
      const { budget, persisted } = await verifyAndSaveControlToken(candidate);
      onChange((current) => syncBudget(current, budget.usedUsd, budget.limitUsd));
      setKey('');
      if (!persisted) setNotice('画面を閉じたあと、次に使うときにもう一度鍵が必要になることがあります。');
    } catch (reason) {
      const rejected = reason instanceof Error && /Invalid personal control authorization|Personal control authorization required|\b(?:401|403)\b/i.test(reason.message);
      setError(rejected
        ? '鍵が合いませんでした。受け取った鍵をもう一度確かめてください。'
        : '鍵を確認できませんでした。少し待ってから、もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  }

  return <div className="wizard-backdrop">
    <section
      ref={containerRef}
      className="wizard-sheet easy-setup-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="かんたん設定"
      tabIndex={-1}
    >
      <h2 ref={headingRef} tabIndex={-1}>{titles[stage]}</h2>
      {notice && <p role="status">{notice}</p>}
      {stage === 'checking' && <p role="status">そのまま少しお待ちください。</p>}
      {stage === 'retry' && <>
        <p>インターネットにつながっているか確かめてください。</p>
        <button type="button" className="primary-button full" onClick={onRetry}>もう一度ためす</button>
      </>}
      {stage === 'key' && <form className="easy-setup-form" onSubmit={(event) => void submitKey(event)}>
        <p>このアプリを用意した人から受け取った鍵を、このスマホに保存します。</p>
        <label>アプリの鍵
          <input type="password" value={key} maxLength={512} autoComplete="off" autoCapitalize="none" spellCheck={false}
            onChange={(event) => { setKey(event.target.value); setError(''); }} />
        </label>
        {error && <p className="easy-setup-error" role="alert">{error}</p>}
        <button type="submit" className="primary-button full">{key.trim() ? 'この鍵で進む' : '鍵を貼り付けて進む'}</button>
      </form>}
      {stage === 'x' && <>
        <p>Xの画面で「許可」を押すと、戻ったあとに投稿や届いたお知らせを読み込みます。</p>
        <XReadConnectButton className="primary-button full" onStarted={onClose} />
      </>}
      {(stage === 'ready' || stage === 'local') && <>
        <p>「今日」を開くと、やることを確認できます。</p>
        <button type="button" className="primary-button full" onClick={onToday}>今日を開く</button>
      </>}
      {stage !== 'ready' && stage !== 'local' && !saving && (
        <button type="button" className="secondary-button full" onClick={onToday}>{stage === 'x' ? '今はつながない' : 'あとで'}</button>
      )}
    </section>
  </div>;
}
