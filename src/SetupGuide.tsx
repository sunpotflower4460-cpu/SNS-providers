import { coreReady, type ConnectionStatus, type StepState, useConnectionStatus } from './connectionStatus';
import './setupGuide.css';

export const SETUP_GUIDE_URL = 'https://github.com/sunpotflower4460-cpu/SNS-providers/blob/main/docs/SETUP_GUIDE_JA.md';

interface Step {
  id: string;
  title: string;
  state: StepState;
  ready: string;
  todo: string;
  how: string[];
  optional?: boolean;
}

function buildSteps(status: ConnectionStatus): Step[] {
  const serverState: StepState = status.server === 'todo' ? 'todo' : status.reachable;
  const afterCore = (state: StepState): StepState => (coreReady(status) ? state : 'unknown');
  return [
    {
      id: 'server',
      title: 'サーバーをつなぐ',
      state: serverState,
      ready: 'サーバーに接続できています。',
      todo: status.server === 'todo'
        ? '今は「この端末だけ」で動いています。AI・自動で探す・X/Instagram連携にはサーバーが必要です。'
        : status.error || 'サーバーに接続できません。',
      how: [
        'Cloudflareにサーバー（worker フォルダ）をデプロイします。GitHubの Actions secrets に CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID を入れると自動でデプロイされます。',
        'デプロイ後に表示される https://…workers.dev のURLを、アプリのビルド設定 VITE_API_BASE_URL に入れて、アプリを再ビルドします。',
        'ホーム画面のアプリを一度閉じて開き直すと、ここが「✓」になります。',
      ],
    },
    {
      id: 'key',
      title: '個人管理キーを保存',
      state: status.server === 'todo' ? 'unknown' : status.key,
      ready: 'この端末にキーが保存されています。',
      todo: 'あなた専用のパスワードです。これがないとサーバー機能は動きません。',
      how: [
        '長いランダムな文字列を1つ決めます（例: パスワード管理アプリで生成）。',
        'その文字列のSHA-256値を、サーバーのシークレット SYNC_TOKEN_SHA256 に登録します。',
        'この画面下の「アプリ・SNS・クラウド接続」→「個人管理キー」に元の文字列を入れ、「キーを確認・保存」を押します。',
      ],
    },
    {
      id: 'ai',
      title: 'AIを有効にする',
      state: afterCore(status.ai),
      ready: 'AIが候補の評価と、いいね・返信の文案づくりに使われます。',
      todo: 'AIキーが未設定です。簡易評価だけで動き、返信文案は作られません。',
      how: [
        'Groq（無料枠あり）でAPIキーを発行します。',
        'サーバーのシークレット GROQ_API_KEY に登録します（GROQ_BILLING_MODE は free のまま）。',
        '「探す」→「候補情報を更新・再評価」→「候補をAIで再評価」でAIが動きます。',
      ],
    },
    {
      id: 'discovery',
      title: '候補を自動で探す',
      state: afterCore(status.discovery),
      ready: 'アプリを開くたびに、目的に合う相手が自動で補充されます。',
      todo: '自動探索が未設定です。手動追加と「今すぐ探す」リンクは使えます。',
      how: [
        'Tavily（無料枠あり）でAPIキーを発行します。',
        'サーバーのシークレット TAVILY_API_KEY に登録し、TAVILY_BILLING_MODE を free にします。',
      ],
    },
    {
      id: 'x',
      title: 'Xアカウントと連携',
      state: afterCore(status.x),
      ready: 'Xと接続済みです。メンションや返信が「今日」に届きます。',
      todo: status.x === 'partial'
        ? 'サーバー側の準備はできています。下の「Xを接続」から自分のアカウントでログインしてください。'
        : 'X開発者アプリが未設定です。',
      how: [
        'X Developer Portal でアプリを作り、種類を「Web App（Confidential）」にします。',
        'コールバックURLを https://（サーバーURL）/api/x/oauth/callback に設定します。',
        'X_CLIENT_ID / X_CLIENT_SECRET / X_OAUTH_CALLBACK_URL / PWA_RETURN_URL / OAUTH_TOKEN_ENCRYPTION_KEY_B64 をサーバーのシークレットに登録します。',
        '下の「アプリ・SNS・クラウド接続」→「Xを読み取り専用で接続」を押してXでログインします。',
      ],
      optional: true,
    },
    {
      id: 'instagram',
      title: 'Instagramと連携',
      state: afterCore(status.instagram),
      ready: 'Instagramと接続済みです。自分の投稿へのコメントが「今日」に届きます。',
      todo: status.instagram === 'partial'
        ? 'トークンが無効か権限が足りません。トークンを再発行してください。'
        : 'Instagram連携が未設定です。',
      how: [
        'Instagramをプロアカウント（クリエイター/ビジネス）に切り替えます。',
        'Meta for Developers でアプリを作り、Instagramログインのアクセストークンを発行します。',
        'INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID / INSTAGRAM_API_VERSION をサーバーのシークレットに登録します。',
      ],
      optional: true,
    },
  ];
}

const stateLabel: Record<StepState, string> = { ready: '完了', todo: '未設定', partial: 'あと少し', unknown: '前の手順から' };
const stateIcon: Record<StepState, string> = { ready: '✓', todo: '!', partial: '…', unknown: '○' };

export function openConnectionSettings() {
  const target = document.getElementById('settings-connections');
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export default function SetupGuide() {
  const { status, refresh } = useConnectionStatus();
  const steps = buildSteps(status);
  const required = steps.filter((step) => !step.optional);
  const doneCount = steps.filter((step) => step.state === 'ready').length;
  const allRequiredReady = required.every((step) => step.state === 'ready');
  const firstTodo = steps.find((step) => step.state !== 'ready');

  return <section className="setup-guide" aria-labelledby="setup-guide-title">
    <div className="setup-guide-head">
      <div>
        <span className="section-kicker">AI・SNS連携</span>
        <h2 id="setup-guide-title">{allRequiredReady ? 'AIは使える状態です' : '連携の準備をする'}</h2>
        <p>{doneCount}/{steps.length} 完了 · 上から順に進めると、AI・X・Instagramが使えるようになります。</p>
      </div>
      <button type="button" className="secondary-button" disabled={status.checking} onClick={() => void refresh()}>{status.checking ? '確認中…' : '再確認'}</button>
    </div>
    <ol className="setup-steps">
      {steps.map((step) => (
        <li key={step.id} className={`setup-step is-${step.state}`}>
          <details open={step === firstTodo && step.state !== 'unknown'}>
            <summary>
              <span className="setup-step-icon" aria-hidden="true">{stateIcon[step.state]}</span>
              <span className="setup-step-copy">
                <strong>{step.title}{step.optional && <em>必要なら</em>}</strong>
                <small>{step.state === 'ready' ? step.ready : step.state === 'unknown' ? '上の手順が終わると確認できます' : step.todo}</small>
              </span>
              <span className="setup-step-state">{stateLabel[step.state]}</span>
            </summary>
            {step.state !== 'ready' && <div className="setup-step-body">
              <ol>{step.how.map((line) => <li key={line}>{line}</li>)}</ol>
            </div>}
          </details>
        </li>
      ))}
    </ol>
    <div className="setup-guide-actions">
      <button type="button" className="secondary-button" onClick={openConnectionSettings}>キー入力・X接続を開く</button>
      <a className="text-button" href={SETUP_GUIDE_URL} target="_blank" rel="noopener noreferrer">詳しい手順を見る（GitHub）</a>
    </div>
  </section>;
}

/** Short notice for Today/Discover/Me when AI or SNS integrations are not usable yet. */
export function SetupBanner({ onOpenSettings, context }: { onOpenSettings: () => void; context: 'today' | 'discover' | 'me' }) {
  const { status } = useConnectionStatus();
  const core = coreReady(status);
  if (core && status.ai !== 'todo' && status.discovery !== 'todo') return null;
  const message = !core
    ? context === 'me'
      ? 'AI分析を使うには、先にサーバーと個人管理キーの準備が必要です。'
      : 'いまは「この端末だけ」で動いています。AIによる候補探し・いいね/返信の文案・X/Instagram連携は、設定の「連携の準備」を済ませると使えます。'
    : status.ai === 'todo'
      ? 'AIキーが未設定のため、簡易評価のみで返信文案は作られません。'
      : '自動の候補探索が未設定です。下の「今すぐ探す」や手動追加は使えます。';
  return <section className="setup-banner" role="note">
    <span aria-hidden="true">i</span>
    <p>{message}</p>
    <button type="button" onClick={onOpenSettings}>準備する</button>
  </section>;
}
