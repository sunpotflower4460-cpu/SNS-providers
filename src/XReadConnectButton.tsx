import { useState } from 'react';
import { friendlyReason } from './friendlyReason';
import { startXOAuth } from './xAccount';

export default function XReadConnectButton({ className = 'primary-button', onStarted }: { className?: string; onStarted?: () => void }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');

  async function connect() {
    setOpening(true);
    setError('');
    try {
      await startXOAuth('read');
      onStarted?.();
    } catch (reason) {
      setError(friendlyReason(reason instanceof Error ? reason.message : 'Xの接続画面を開けませんでした'));
    } finally {
      setOpening(false);
    }
  }

  return <>
    <button type="button" className={className} disabled={opening} onClick={() => void connect()}>
      {opening ? 'Xを開いています…' : 'Xをつなぐ'}
    </button>
    {error && <p className="wizard-problem" role="alert">{error}</p>}
  </>;
}
