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
    setNote('インストール確認を開いています…');
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') {
      setNote('ホーム画面への追加を受け付けました');
      setPromptEvent(null);
    } else {
      setNote('今回は追加しませんでした。いつでもSettingsから追加できます');
    }
  }

  return <section className="form-card install-card">
    <div className="field-title">
      <div><strong>スマホへインストール</strong><span>ホーム画面から普通のアプリのように起動</span></div>
      <b>{installed ? 'APP' : 'PWA'}</b>
    </div>

    {installed ? <div className="hard-limit"><span>INSTALL</span><strong>READY</strong><p>この端末ではホーム画面アプリとして起動しています。</p></div> : promptEvent ? <>
      <p>このブラウザはPWAのインストールに対応しています。下のボタンからホーム画面へ追加できます。</p>
      <button className="primary-button" onClick={install}>ホーム画面へ追加</button>
    </> : iosSafari ? <div className="x-scope-note">
      <strong>iPhone / iPad</strong>
      <span>Safariの共有ボタン → 「ホーム画面に追加」 → 「追加」の順で登録してください。登録後は独立したアプリ画面で開きます。</span>
    </div> : <div className="x-scope-note">
      <strong>インストールメニューから追加</strong>
      <span>ブラウザのメニューに「アプリをインストール」「ホーム画面に追加」が表示されていれば、そこから登録できます。</span>
    </div>}

    <small>{note || 'PWAのインストールだけならSNS/APIの追加料金は発生しません。'}</small>
  </section>;
}
