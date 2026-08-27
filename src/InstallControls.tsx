import { useEffect, useMemo, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isStandalone() {
  const displayStandalone = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  return displayStandalone || iosStandalone;
}

function isIosSafariLike() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const webkit = /WebKit/.test(ua);
  const alternateBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return ios && webkit && !alternateBrowser;
}

export default function InstallControls() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => isStandalone());
  const [note, setNote] = useState('');
  const iosSafari = useMemo(() => isIosSafariLike(), []);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
      setNote('ホーム画面へ追加しました');
    };
    const media = window.matchMedia?.('(display-mode: standalone)');
    const onDisplayChange = () => setInstalled(isStandalone());

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    media?.addEventListener?.('change', onDisplayChange);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      media?.removeEventListener?.('change', onDisplayChange);
    };
  }, []);

  async function install() {
    if (!promptEvent) return;
    setNote('追加の確認画面を開いています…');
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setNote('ホーム画面への追加を受け付けました');
      setPromptEvent(null);
    } else {
      setNote('今回は追加しませんでした。いつでも設定から追加できます');
    }
  }

  return <section className="form-card install-card">
    <div className="field-title">
      <div><strong>ホーム画面からすぐ開く</strong><span>スマホやPCに追加すると、普通のアプリのように起動できます</span></div>
      <b>{installed ? '追加済' : '任意'}</b>
    </div>

    {installed ? <div className="hard-limit"><span>この端末</span><strong>追加済み</strong><p>ホーム画面アプリとして起動しています。</p></div> : promptEvent ? <>
      <p>このブラウザでは、下のボタンからホーム画面へ追加できます。</p>
      <button className="primary-button" onClick={install}>ホーム画面へ追加</button>
    </> : iosSafari ? <div className="x-scope-note">
      <strong>iPhone / iPadで追加する方法</strong>
      <span>Safari下部の共有ボタン → 「ホーム画面に追加」 → 「追加」の順でタップしてください。</span>
    </div> : <div className="x-scope-note">
      <strong>ブラウザのメニューから追加</strong>
      <span>「アプリをインストール」または「ホーム画面に追加」が表示されていれば、そこから登録できます。</span>
    </div>}

    <small>{note || 'ホーム画面への追加だけで、SNSやAIの利用料金が増えることはありません。'}</small>
  </section>;
}
