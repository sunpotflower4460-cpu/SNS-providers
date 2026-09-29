import { useEffect, useMemo, useRef, useState } from 'react';
import { type ConnectionStatus, helpChatAvailable, useConnectionStatus } from './connectionStatus';
import { friendlyReason } from './friendlyReason';
import { GROUP_LABEL, helpPrompt, type StepGroup, WIZARD_STEPS, type WizardStep } from './setupSteps';
import { useModalA11y } from './useModalA11y';
import { clearTodoChecks, isIosHomeScreenApp, loadPosition, loadTodoChecks, safariUrl, savePosition, saveTodoChecks } from './wizardMemory';
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

/**
 * Remember steps the server has proven done (e.g. Cloudflare provisioning once the Worker
 * answers). A later outage then points the user at the connection step instead of asking
 * them to recreate tokens that are still valid.
 */
export function rememberAutoCompleted(status: ConnectionStatus) {
  const done = loadDone();
  let changed = false;
  for (const step of WIZARD_STEPS) {
    if (!step.verify && !done.has(step.id) && step.done?.(status)) {
      done.add(step.id);
      changed = true;
    }
  }
  if (changed) saveDone(done);
  return done;
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
    // A persisted position only wins while the popup was left open (iOS reload); after an
    // explicit close, resume from the first unfinished step instead.
    const saved = loadPosition();
    const remembered = lastPosition || (saved?.open ? saved : null);
    if (remembered?.group === group) {
      const resumed = steps.findIndex((item) => item.id === remembered.id);
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
    const remembered = rememberAutoCompleted(status);
    if (remembered.size !== done.size) setDone(remembered);
  }, [status]);

  useEffect(() => {
    lastPosition = step ? { group, id: step.id } : null;
    // Persisted with open=true so the popup comes back on the same step if iOS reloads
    // the home-screen app while the user is on Cloudflare / X.
    savePosition(step ? { group, id: step.id, open: true } : null);
  }, [group, step]);

  // Returning from the page the step opened: say where to continue.
  const [leftAt, setLeftAt] = useState(0);
  const [welcomeBack, setWelcomeBack] = useState(false);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && leftAt && Date.now() - leftAt > 1500) setWelcomeBack(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [leftAt]);
  useEffect(() => {
    // A new step starts fresh: only a link opened from this step counts as "returning".
    setWelcomeBack(false);
    setLeftAt(0);
  }, [step?.id]);

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
      clearTodoChecks([step.id]);
      go(index + 1);
      return;
    }
    setChecking(true);
    try {
      const latest = await refresh();
      if (step.done?.(latest)) {
        clearTodoChecks([step.id]);
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
        {welcomeBack && <p className="wizard-welcome" role="status">おかえりなさい。✓ が付いていないところから続けてください。</p>}
        {step.open && <OpenLink href={step.open.href} label={step.open.label} onLeave={() => setLeftAt(Date.now())} />}
        <TodoList stepId={step.id} items={step.todo} />
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
      <button type="button" className="secondary-button full" onClick={() => {
        const groupSteps = WIZARD_STEPS.filter((item) => item.group === group);
        clearTodoChecks(groupSteps.map((item) => item.id));
        onJump(groupSteps[0].id);
      }}>手順を最初から見直す</button>
      {others.map((item) => <button type="button" key={item} className="secondary-button full" onClick={() => onGroup(item)}>{GROUP_LABEL[item]}（必要なら）</button>)}
    </div>
  </div>;
}

/** Tickable todos, remembered per step, so "which one was I on?" has an answer. */
function TodoList({ stepId, items }: { stepId: string; items: string[] }) {
  const [checks, setChecks] = useState(() => loadTodoChecks(stepId));
  function toggle(index: number) {
    const next = items.map((_, position) => (position === index ? !checks[position] : checks[position] === true));
    setChecks(next);
    saveTodoChecks(stepId, next);
  }
  const current = items.findIndex((_, index) => !checks[index]);
  return <ol className="wizard-todo">
    {items.map((line, index) => (
      <li key={line} className={checks[index] ? 'is-checked' : index === current ? 'is-current' : ''}>
        <button type="button" role="checkbox" aria-checked={checks[index] === true} onClick={() => toggle(index)}>
          <span className="wizard-check" aria-hidden="true">{checks[index] ? '✓' : index + 1}</span>
          <span>{line}{index === current && <em>いまここ</em>}</span>
        </button>
      </li>
    ))}
  </ol>;
}

/**
 * On an iPhone home-screen app a normal link opens in a sheet that covers the steps. Open
 * the Safari app instead, so the user can flip between Safari and this app, with a plain
 * link as the fallback for older iOS.
 */
function OpenLink({ href, label, onLeave }: { href: string; label: string; onLeave: () => void }) {
  const ios = isIosHomeScreenApp();
  return <div className="wizard-open-wrap">
    <a className="wizard-open" href={ios ? safariUrl(href) : href} target="_blank" rel="noopener noreferrer" onClick={onLeave}>{ios ? label.replace(/を開く$/, 'をSafariで開く') : label}<span aria-hidden="true">↗</span></a>
    <p className="wizard-note">{ios
      ? <>Safariで開くので、画面の下のバーを左右にスワイプすると、このアプリとすぐ行き来できます。ここに戻ると同じ手順が表示されます。<a href={href} target="_blank" rel="noopener noreferrer" onClick={onLeave}>うまく開かないとき</a></>
      : '別のタブで開きます。終わったらこのタブに戻ってください。同じ手順が表示されます。'}</p>
  </div>;
}

function HelpFooter({ step, canUseAppAi }: { step: WizardStep; canUseAppAi: boolean }) {
  const prompt = helpPrompt(step);
  const [copied, setCopied] = useState(false);
  // Gemini has no prefill URL. The anchor opens synchronously on tap (mobile Safari blocks
  // window.open after an awaited clipboard call); the copy starts in the same click.
  function copyPrompt() {
    navigator.clipboard?.writeText(prompt).then(() => setCopied(true), () => setCopied(false));
  }
  return <footer className="wizard-help">
    <div>
      <span>わからない場合はこちら：</span>
      {canUseAppAi && <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_HELP_CHAT_EVENT, { detail: prompt }))}>アプリ内AIに聞く</button>}
      <a href={`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noopener noreferrer">ChatGPTに聞く</a>
      <a href={`https://claude.ai/new?q=${encodeURIComponent(prompt)}`} target="_blank" rel="noopener noreferrer">Claudeに聞く</a>
      <a href="https://gemini.google.com/app" target="_blank" rel="noopener noreferrer" onClick={copyPrompt}>{copied ? 'Geminiに聞く（質問をコピー済み・貼り付けてね）' : 'Geminiに聞く'}</a>
      <a href={GUIDE_URL} target="_blank" rel="noopener noreferrer">くわしい説明</a>
      <span className="wizard-help-note">（質問文は自動で入ります・無料版でOK）</span>
    </div>
  </footer>;
}
