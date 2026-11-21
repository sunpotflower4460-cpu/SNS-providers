import { useEffect, useState } from 'react';
import { coreReady, useConnectionStatus, xReadConnectAvailable } from './connectionStatus';
import { openSetupWizard, rememberAutoCompleted } from './SetupWizard';
import { openEasySetup } from './EasySetup';
import { loadThemePreference, saveThemePreference, type ThemePreference } from './themePreference';
import XReadConnectButton from './XReadConnectButton';
import './setupGuide.css';

export default function SetupGuide() {
  const { status } = useConnectionStatus();
  useEffect(() => { rememberAutoCompleted(status); }, [status]);
  const connectX = !status.checking && xReadConnectAvailable(status);
  const ready = !status.checking && !status.error && status.reachable === 'ready' && status.key === 'ready';

  return <section className="setup-card" aria-labelledby="setup-card-title">
    <h2 id="setup-card-title">かんたん設定</h2>
    <p>{connectX
      ? 'Xの画面で「許可」を押すと、投稿や届いたお知らせを読めるようになります。'
      : ready ? 'このスマホで使う準備ができています。' : 'アプリが準備を確かめ、必要なことを一つずつ案内します。'}</p>
    {connectX
      ? <XReadConnectButton className="primary-button full easy-setup-launch" />
      : <button type="button" className="primary-button full easy-setup-launch" onClick={openEasySetup}>{ready ? '使える状態を確認する' : '設定をはじめる'}</button>}
    <details className="candidate-details easy-setup-advanced">
      <summary>くわしい設定</summary>
      <div className="candidate-details-body easy-setup-advanced-actions">
        <button type="button" className="secondary-button full" onClick={() => openSetupWizard('core')}>アプリを用意する人向けの設定</button>
        <button type="button" className="secondary-button full" onClick={() => openSetupWizard('x')}>Xのくわしい設定</button>
        <button type="button" className="secondary-button full" onClick={() => openSetupWizard('instagram')}>Instagramのくわしい設定</button>
      </div>
    </details>
  </section>;
}

export function ThemeSwitcher() {
  const [value, setValue] = useState<ThemePreference>(loadThemePreference);
  const options: Array<[ThemePreference, string]> = [['auto', '自動'], ['light', 'ライト'], ['dark', 'ダーク']];
  return <section className="theme-switcher" aria-label="画面の明るさ">
    <span>画面の明るさ</span>
    <div className="theme-switcher-options" role="group">
      {options.map(([id, label]) => <button type="button" key={id} aria-pressed={value === id} className={value === id ? 'active' : ''} onClick={() => { saveThemePreference(id); setValue(id); }}>{label}</button>)}
    </div>
  </section>;
}

/** Short notice for Today/Discover/Me while AI or SNS integrations are not usable yet. */
export function SetupBanner({ context }: { context: 'today' | 'discover' | 'me' }) {
  const { status } = useConnectionStatus();
  const core = coreReady(status);
  if (core && status.ai !== 'todo' && status.discovery !== 'todo') return null;
  const message = !core
    ? context === 'me' ? 'おすすめを受け取る準備をします。' : 'おすすめや文案を受け取る準備をします。'
    : status.ai === 'todo' ? 'おすすめを受け取る設定を確認できます。' : '相手を自動で探す設定を確認できます。';
  return <section className="setup-banner" role="note">
    <p>{message}</p>
    <button type="button" onClick={openEasySetup}>かんたん設定</button>
  </section>;
}
