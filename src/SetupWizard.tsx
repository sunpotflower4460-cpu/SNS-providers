import { useEffect, useMemo, useRef, useState } from 'react';
import { type ConnectionStatus, helpChatAvailable, useConnectionStatus } from './connectionStatus';
import { friendlyReason } from './friendlyReason';
import { GROUP_LABEL, helpPrompt, type StepGroup, WIZARD_STEPS, type WizardStep } from './setupSteps';
import { useModalA11y } from './useModalA11y';
import './wizard.css';

export const OPEN_SETUP_EVENT = 'sns-providers:open-setup';
export const OPEN_HELP_CHAT_EVENT = 'sns-providers:open-help-chat';
const DONE_KEY = 'sns-providers:wizard-done';
const GUIDE_URL = 'https://github.com/sunpotflower4460-cpu/SNS-providers/blob/main/docs/SETUP_GUIDE_JA.md';

// Where the user was, so closing the wizard to ask the help chat (or by accident) resumes
// on the same step instead of the first unfinished one.
let lastPosition: { group: StepGroup; id: string } | null = null;

export function openSetupWizard(group?: StepGroup) {
  window.dispatchEvent(new CustomEvent(OPEN_SETUP_EVENT, { detail: group }));
}

function loadDone(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.filter((item) => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveDone(done: Set<string>) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    // Progress memory is a convenience; the wizard still works for this session.
  }
}

export function stepComplete(step: WizardStep, status: ConnectionStatus, done: Set<string>) {
  return Boolean(step.done?.(status)) || (!step.verify && done.has(step.id));
}

export function nextOpenStep(group: StepGroup, status: ConnectionStatus, done = loadDone()) {
  return WIZARD_STEPS.filter((step) => step.group === group).find((step) => !stepComplete(step, status, done)) || null;
}

export default function SetupWizard({ initialGroup, onClose, onGoToday, onGroupChange }: { initialGroup?: StepGroup; onClose: () => void; onGoToday: () => void; onGroupChange?: (group: StepGroup) => void }) {
  const { status, refresh } = useConnectionStatus();
  const [done, setDone] = useState(loadDone);
  const [group, setGroup] = useState<StepGroup>(() => initialGroup || (nextOpenStep('core', status) ? 'core' : 'x'));
  const steps = useMemo(() => WIZARD_STEPS.filter((step) => step.group === group), [group]);
  const [index, setIndex] = useState(() => {
    if (lastPosition?.group === group) {
      const resumed = steps.findIndex((item) => item.id === lastPosition?.id);
      if (resumed >= 0) return resumed;
    }
    const first = steps.findIndex((step) => !stepComplete(step, status, loadDone()));
    return first < 0 ? steps.length : first;
  });
  const [checking, setChecking] = useState(false);
  const [problem, setProblem] = useState('');
  const containerRef = useModalA11y<HTMLElement>(onClose);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const step = steps[index];

  useEffect(() => {
    lastPosition = step ? { group, id: step.id } : null;
  }, [group, step]);

  useEffect(() => {
    if (problem) problemRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [problem]);

  function markDone(id: string) {
    const next = new Set(done);
    next.add(id);
    setDone(next);
    saveDone(next);
  }

  function go(nextIndex: number) {
    setProblem('');
    setIndex(Math.max(0, Math.min(steps.length, nextIndex)));
  }

  function switchGroup(nextGroup: StepGroup) {
    const nextSteps = WIZARD_STEPS.filter((item) => item.group === nextGroup);
    const first = nextSteps.findIndex((item) => !stepComplete(item, status, done));
    setGroup(nextGroup);
    onGroupChange?.(nextGroup);
    setProblem('');
    setIndex(first < 0 ? nextSteps.length : first);
  }

  async function confirm() {
    if (!step) return;
    if (!step.verify) {
      markDone(step.id);
      go(index + 1);
      return;
    }
    setChecking(true);
    try {
      const latest = await refresh();
      if (step.done?.(latest)) {
        go(index + 1);
      } else {
        setProblem(latest.error ? friendlyReason(latest.error) : 'まだ確認できませんでした。登録後、反映まで1〜2分かかることがあります。少し待ってからもう一度押してください。');
      }
    } finally {
      setChecking(false);
    }
  }

  return <div className="wizard-backdrop" onClick={onClose}>
    <section ref={containerRef} className="wizard-sheet" role="dialog" aria-modal="true" aria-labelledby="wizard-title" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <div className="wizard-head">
        <span>{GROUP_LABEL[group]}{step ? ` · ${index + 1} / ${steps.length}` : ''}</span>
        <button type="button" className="wizard-close" aria-label="閉じる" onClick={onClose}>×</button>
      </div>
      <div className="wizard-progress" aria-hidden="true"><span style={{ width: `${Math.round((Math.min(index, steps.length) / steps.length) * 100)}%` }} /></div>

      {step ? <div className="wizard-body" key={step.id}>
        <p className="wizard-kicker">次はこれをやりましょう · 約{step.minutes}分</p>
        <h2 id="wizard-title">{step.title}</h2>
        <p className="wizard-why">{step.why}</p>
        {step.open && <a className="wizard-open" href={step.open.href} target="_blank" rel="noopener noreferrer">{step.open.label}<span aria-hidden="true">↗</span></a>}
        <ol className="wizard-todo">{step.todo.map((line) => <li key={line}>{line}</li>)}</ol>
        {step.extra && <div className="wizard-extra">{step.extra()}</div>}
        {problem && <p ref={problemRef} className="wizard-problem" role="alert">{problem}</p>}
      </div> : <GroupDone group={group} status={status} done={done} onGroup={switchGroup} onJump={(id) => go(steps.findIndex((item) => item.id === id))} onGoToday={() => { onClose(); onGoToday(); }} />}

      {step && <div className="wizard-nav">
        <button type="button" className="secondary-button" disabled={index === 0} onClick={() => go(index - 1)}>戻る</button>
        <button type="button" className="primary-button" disabled={checking} onClick={() => void confirm()}>{checking ? '確認中…' : 'できた → 次へ'}</button>
      </div>}
      {step && problem && <button type="button" className="text-button wizard-skip" onClick={() => go(index + 1)}>確認せずに次へ進む</button>}

      {step && <HelpFooter step={step} canUseAppAi={helpChatAvailable(status)} />}
    </section>
  </div>;
}

const DONE_MESSAGE: Record<StepGroup, string> = {
  core: 'これでAIが相手を探し、いいね・返信の文案を用意します。「今日」を開いてみましょう。',
  x: 'Xのメンションや返信が「今日」に並び、AIが返信の文案を用意します。',
  instagram: '自分の投稿へのコメントが「今日」に並びます。DMの取り込みは追加の設定が必要です（くわしい説明を参照）。',
};

function GroupDone({ group, status, done, onGroup, onJump, onGoToday }: {
  group: StepGroup;
  status: ConnectionStatus;
  done: Set<string>;
  onGroup: (group: StepGroup) => void;
  onJump: (id: string) => void;
  onGoToday: () => void;
}) {
  // Re-check instead of trusting the step counter: 「確認せずに次へ」 may have skipped a
  // step that the server still reports as unfinished.
  const pending = WIZARD_STEPS.filter((item) => item.group === group && !stepComplete(item, status, done));
  const others = (['core', 'x', 'instagram'] as StepGroup[]).filter((item) => item !== group && nextOpenStep(item, status, done));
  if (pending.length) {
    return <div className="wizard-body wizard-done">
      <p className="wizard-kicker">あと少しです</p>
      <h2 id="wizard-title">まだ確認できていない手順があります</h2>
      <p className="wizard-why">反映に1〜2分かかることがあります。少し待ってから、もう一度確認してください。</p>
      <div className="wizard-choices">
        {pending.map((item) => <button type="button" key={item.id} className="secondary-button full" onClick={() => onJump(item.id)}>「{item.title}」を確認する</button>)}
      </div>
    </div>;
  }
  return <div className="wizard-body wizard-done">
    <p className="wizard-kicker">おつかれさまでした</p>
    <h2 id="wizard-title">「{GROUP_LABEL[group]}」は完了です</h2>
    <p className="wizard-why">{DONE_MESSAGE[group]}</p>
    <div className="wizard-choices">
      <button type="button" className="primary-button full" onClick={onGoToday}>「今日」を見る</button>
      {others.map((item) => <button type="button" key={item} className="secondary-button full" onClick={() => onGroup(item)}>{GROUP_LABEL[item]}（必要なら）</button>)}
    </div>
  </div>;
}

function HelpFooter({ step, canUseAppAi }: { step: WizardStep; canUseAppAi: boolean }) {
  const prompt = helpPrompt(step);
  const [copied, setCopied] = useState(false);
  async function copyThenOpen(url: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
    } catch {
      setCopied(false);
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return <footer className="wizard-help">
    <div>
      <span>わからない場合はこちら：</span>
      {canUseAppAi && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_HELP_CHAT_EVENT, { detail: prompt }))}>アプリ内AIに聞く</button>}
      <a href={`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noopener noreferrer">ChatGPTに聞く</a>
      <a href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noopener noreferrer">Claudeに聞く</a>
      <button type="button" onClick={() => void copyThenOpen('https://gemini.google.com/app')}>{copied ? '質問をコピー済み・Geminiへ' : 'Geminiに聞く'}</button>
      <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer">くわしい説明</a>
      <span className="wizard-help-note">（質問文は自動で入ります・無料版でOK）</span>
    </div>
  </footer>;
}
