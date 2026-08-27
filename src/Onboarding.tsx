import { useState } from 'react';
import { GUIDE_SECTIONS } from './guideContent';
import { useModalA11y } from './useModalA11y';
import './guide.css';

interface Props {
  onFinish: () => void;
  onOpenManual: () => void;
}

export default function Onboarding({ onFinish, onOpenManual }: Props) {
  const [step, setStep] = useState(0);
  const section = GUIDE_SECTIONS[step];
  const isLast = step === GUIDE_SECTIONS.length - 1;
  const containerRef = useModalA11y<HTMLElement>(onFinish);

  return (
    <div className="guide-backdrop" onClick={onFinish}>
      <section ref={containerRef} className="guide-tour" role="dialog" aria-modal="true" aria-label="Social Missionの使い方" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="guide-tour-top">
          <div className="guide-dots">
            {GUIDE_SECTIONS.map((item, index) => (
              <span key={item.id} className={index === step ? 'guide-dot active' : 'guide-dot'} />
            ))}
          </div>
          <button className="text-button" onClick={onFinish}>スキップ</button>
        </div>

        <div className="guide-tour-body">
          <span className="guide-icon">{section.icon}</span>
          <span className="eyebrow">{section.eyebrow}</span>
          <h2>{section.title}</h2>
          <GuideSectionBody section={section} />
        </div>

        <div className="guide-tour-nav">
          {step > 0 && <button className="secondary-button" onClick={() => setStep((current) => current - 1)}>戻る</button>}
          {!isLast && <button className="primary-button full" onClick={() => setStep((current) => current + 1)}>次へ<span>›</span></button>}
          {isLast && <button className="primary-button full" onClick={onFinish}>はじめる</button>}
        </div>
        {isLast && <button className="text-button guide-manual-link" onClick={() => { onOpenManual(); onFinish(); }}>後でいつでも「？」から見返せます</button>}
      </section>
    </div>
  );
}

export function GuideSectionBody({ section }: { section: (typeof GUIDE_SECTIONS)[number] }) {
  return <>
    {section.paragraphs && section.paragraphs.map((text, index) => <p key={index}>{text}</p>)}
    {section.steps && <ol className="guide-list">{section.steps.map((text, index) => <li key={index}>{text}</li>)}</ol>}
    {section.bullets && <ul className="guide-list">{section.bullets.map((text, index) => <li key={index}>{text}</li>)}</ul>}
    {section.items && <dl className="guide-terms">{section.items.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.desc}</dd></div>)}</dl>}
  </>;
}
