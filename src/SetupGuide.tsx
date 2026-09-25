import { useEffect, useState } from 'react';
import { coreReady, useConnectionStatus } from './connectionStatus';
import { nextOpenStep, openSetupWizard, rememberAutoCompleted } from './SetupWizard';
import { GROUP_LABEL, type StepGroup, WIZARD_STEPS } from './setupSteps';
import { loadThemePreference, saveThemePreference, type ThemePreference } from './themePreference';
import './setupGuide.css';

/** Settings summary: one progress bar and one button that resumes the step-by-step popup. */
export default function SetupGuide() {
  const { status } = useConnectionStatus();
  useEffect(() => { rememberAutoCompleted(status); }, [status]);
  const next = nextOpenStep('core', status);
  const coreSteps = WIZARD_STEPS.filter((step) => step.group === 'core');
  const doneCount = next ? coreSteps.findIndex((step) => step.id === next.id) : coreSteps.length;
  const optional: StepGroup[] = ['x', 'instagram'];

  return <section className="setup-card" aria-labelledby="setup-card-title">
    <span className="section-kicker">AI・SNS連携</span>
    <h2 id="setup-card-title">{next ? '準備を進めましょう' : 'AIは使える状態です'}</h2>
    <div className="setup-card-progress" aria-label={`基本の準備 ${doneCount} / ${coreSteps.length}`}><span style={{ width: `${Math.round((doneCount / coreSteps.length) * 100)}%` }} /></div>
    <p>{next ? <>次は <b>「{next.title}」</b>（約{next.minutes}分）</> : '基本の準備は完了しています。'}</p>
    {next
      ? <button type="button" className="primary-button full" onClick={() => openSetupWizard('core')}>{doneCount === 0 ? '準備をはじめる' : '続きから始める'}</button>
      : <button type="button" className="secondary-button full" onClick={() => openSetupWizard('core')}>準備の手順を見直す（キーの入れ替えなど）</button>}
    <div className="setup-card-optional">
      {optional.map((group) => {
        const pending = nextOpenStep(group, status);
        const ready = group === 'x' ? status.x === 'ready' : status.instagram === 'ready';
        return <button type="button" key={group} className="secondary-button" disabled={!coreReady(status) && !ready} onClick={() => openSetupWizard(group)}>
          {ready || !pending ? `✓ ${GROUP_LABEL[group]}` : GROUP_LABEL[group]}
        </button>;
      })}
    </div>
    <small>{coreReady(status) ? 'X・Instagramは必要な人だけで大丈夫です。' : 'X・Instagramは、基本の準備が終わると進められます（必要な人だけ）。'}</small>
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
    ? context === 'me' ? 'AI分析は、準備（約20分）のあとに使えます。' : 'AIのおすすめ・文案は、準備（約20分）のあとに使えます。'
    : status.ai === 'todo' ? 'AIのキーが未設定です。' : '自動で相手を探す設定がまだです。';
  return <section className="setup-banner" role="note">
    <p>{message}</p>
    <button type="button" onClick={() => openSetupWizard('core')}>準備する</button>
  </section>;
}
