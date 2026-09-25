import { useState } from 'react';
import DemoPreview from './DemoPreview';
import type { GUIDE_SECTIONS } from './guideContent';
import { useModalA11y } from './useModalA11y';
import './guide.css';

interface Props {
  onFinish: () => void;
  onStartSetup: () => void;
}

const SLIDES = [
  { kicker: 'こんなアプリです', title: '毎日「今日」を開いて、上から順にやるだけ' },
  { kicker: 'AIがやること・あなたがやること', title: 'AIが相手と文案を用意。あなたは1件ずつOKするだけ' },
  { kicker: 'はじめに1回だけ', title: 'まずは準備をしましょう' },
];

/** Three visual slides: what daily use looks like, who does what, then start setup. */
export default function Onboarding({ onFinish, onStartSetup }: Props) {
  const [step, setStep] = useState(0);
  const slide = SLIDES[step];
  const isLast = step === SLIDES.length - 1;
  const containerRef = useModalA11y<HTMLElement>(onFinish);

  return (
    <div className="guide-backdrop" onClick={onFinish}>
      <section ref={containerRef} className="guide-tour" role="dialog" aria-modal="true" aria-label="Social Missionの使い方" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="guide-tour-top">
          <div className="guide-dots">
            {SLIDES.map((item, index) => <span key={item.title} className={index === step ? 'guide-dot active' : 'guide-dot'} />)}
          </div>
          <button className="text-button" onClick={onFinish}>スキップ</button>
        </div>

        <div className="guide-tour-body">
          <span className="eyebrow">{slide.kicker}</span>
          <h2>{slide.title}</h2>
          {step === 0 && <>
            <p>返信・いいね・フォローの「今日やること」が並びます。</p>
            <DemoPreview />
          </>}
          {step === 1 && <ol className="demo-flow">
            <li><span><b>AI</b>があなたの目的に合う人を探す</span></li>
            <li><span><b>AI</b>が「いいね・返信・フォロー」と返信の文案を提案</span></li>
            <li><span><b>あなた</b>が確認してOK。勝手に送ることはありません</span></li>
          </ol>}
          {step === 2 && <>
            <p>AIとX・Instagramを使うための準備を、1画面ずつ「次はこれ」と案内します（約20分・1回だけ）。</p>
            <p>準備の前でも「探す」→「今すぐ探す」から、XやInstagramで相手を探せます。</p>
          </>}
        </div>

        <div className="guide-tour-nav">
          {!isLast && <button className="primary-button full" onClick={() => setStep((current) => current + 1)}>次へ<span>›</span></button>}
          {isLast && <button className="primary-button full" onClick={() => { onFinish(); onStartSetup(); }}>準備をはじめる</button>}
          {isLast && <button className="secondary-button" onClick={onFinish}>あとで</button>}
          {step > 0 && !isLast && <button className="secondary-button" onClick={() => setStep((current) => current - 1)}>戻る</button>}
        </div>
      </section>
    </div>
  );
}

export function GuideSectionBody({ section }: { section: (typeof GUIDE_SECTIONS)[number] }) {
  return <>
    {section.paragraphs && section.paragraphs.map((text, index) => <p key={index}>{text}</p>)}
    {section.steps && <ol className="guide-list">{section.steps.map((text, index) => <li key={index}>{text}</li>)}</ol>}
    {section.items && <dl className="guide-terms">{section.items.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.desc}</dd></div>)}</dl>}
    {section.bullets && <ul className="guide-list">{section.bullets.map((text, index) => <li key={index}>{text}</li>)}</ul>}
  </>;
}
