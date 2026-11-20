import './demo.css';

/**
 * Static sample of the 今日 screen, used in onboarding and the empty Today state so a
 * new user sees what daily use looks like. Never stored in AppState.
 */
export default function DemoPreview({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? 'demo-preview is-compact' : 'demo-preview'} aria-label="使い方の見本">
    <span className="demo-badge">見本</span>
    <article className="demo-card">
      <span className="demo-icon is-reply" aria-hidden="true">↩</span>
      <div>
        <small>返信 · X</small>
        <strong>@hana_music があなたの投稿にコメント</strong>
        {!compact && <p className="demo-draft">AIの文案：「聴いてくれてありがとう！次のライブもぜひ来てね」</p>}
        <div className="demo-actions"><span className="is-primary">確認して送る</span><span>明日へ</span></div>
      </div>
    </article>
    <article className="demo-card">
      <span className="demo-icon is-like" aria-hidden="true">♡</span>
      <div>
        <small>いいね · X</small>
        <strong>@indie_tokyo の新曲の投稿</strong>
        <div className="demo-actions"><span className="is-primary">Xで開く</span><span>明日へ</span></div>
      </div>
    </article>
    <article className="demo-card">
      <span className="demo-icon is-follow" aria-hidden="true">＋</span>
      <div>
        <small>フォロー · Instagram · 相性 86</small>
        <strong>@sora_live と新しくつながる</strong>
        <div className="demo-actions"><span className="is-primary">Instagramで開く</span><span>明日へ</span></div>
      </div>
    </article>
  </div>;
}
