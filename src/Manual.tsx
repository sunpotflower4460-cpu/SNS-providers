import { GUIDE_SECTIONS } from './guideContent';
import { GuideSectionBody } from './Onboarding';
import { useModalA11y } from './useModalA11y';
import './guide.css';

interface Props {
  onClose: () => void;
}

export default function Manual({ onClose }: Props) {
  const containerRef = useModalA11y<HTMLElement>(onClose);
  return (
    <div className="guide-backdrop" onClick={onClose}>
      <section ref={containerRef} className="guide-manual" role="dialog" aria-modal="true" aria-label="使い方ガイド" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
        <div className="guide-manual-head">
          <div><span className="eyebrow">GUIDE</span><h2>使い方ガイド</h2></div>
          <button className="guide-close" onClick={onClose} aria-label="閉じる">×</button>
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
