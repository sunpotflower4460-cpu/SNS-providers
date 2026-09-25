import { GUIDE_SECTIONS } from './guideContent';
import { GuideSectionBody } from './Onboarding';
import { OPEN_HELP_CHAT_EVENT, openSetupWizard } from './SetupWizard';
import { useModalA11y } from './useModalA11y';
import './guide.css';

interface Props {
  onClose: () => void;
  canAskAi: boolean;
}

const EXTERNAL_PROMPT = '「Social Mission」というスマホアプリの使い方を教えてください。XやInstagramでつながる相手をAIが探し、いいね・返信・フォローの候補と返信文案を出してくれるアプリです。';

export default function Manual({ onClose, canAskAi }: Props) {
  const containerRef = useModalA11y<HTMLElement>(onClose);
  return (
    <div className="guide-backdrop" onClick={onClose}>
      <section ref={containerRef} className="guide-manual" role="dialog" aria-modal="true" aria-label="使い方ガイド" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="guide-manual-head">
          <div><span className="eyebrow">GUIDE</span><h2>使い方ガイド</h2></div>
          <button className="guide-close" onClick={onClose} aria-label="閉じる">×</button>
        </div>
        <div className="guide-quick">
          <button type="button" className="primary-button" onClick={() => { onClose(); openSetupWizard('core'); }}>準備を1ステップずつ進める</button>
          {canAskAi
            ? <button type="button" className="secondary-button" onClick={() => { onClose(); window.dispatchEvent(new CustomEvent(OPEN_HELP_CHAT_EVENT, { detail: '' })); }}>アプリ内AIに聞く</button>
            : <a className="secondary-button" href={`https://chatgpt.com/?q=${encodeURIComponent(EXTERNAL_PROMPT)}`} target="_blank" rel="noopener noreferrer">ChatGPTに聞く（無料版でOK）</a>}
        </div>
        <div className="guide-manual-scroll">
          {GUIDE_SECTIONS.map((section) => (
            <article className="guide-manual-section" key={section.id}>
              <div className="guide-manual-section-head"><span className="guide-icon small">{section.icon}</span><div><span className="eyebrow">{section.eyebrow}</span><h3>{section.title}</h3></div></div>
              <GuideSectionBody section={section} />
            </article>
          ))}
        </div>
        <button className="primary-button full guide-manual-close" onClick={onClose}>閉じる</button>
      </section>
    </div>
  );
}
