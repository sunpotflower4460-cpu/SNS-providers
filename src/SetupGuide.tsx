import type { ReactNode } from 'react';
import { coreReady, type ConnectionStatus, type StepState, useConnectionStatus } from './connectionStatus';
import { appUrl, CopyField, PersonalKeyMaker, serverUrl, XPriceTable, XSetupValues } from './setupHelpers';
import './setupGuide.css';

export const SETUP_GUIDE_URL = 'https://github.com/sunpotflower4460-cpu/SNS-providers/blob/main/docs/SETUP_GUIDE_JA.md';

interface Step {
  id: string;
  title: string;
  state: StepState;
  ready: string;
  todo: string;
  minutes: string;
  body: ReactNode;
  optional?: boolean;
}

function Sub({ title, children }: { title: string; children: ReactNode }) {
  return <div className="setup-sub"><strong>{title}</strong>{children}</div>;
}

function Steps({ items }: { items: ReactNode[] }) {
  return <ol className="setup-howto">{items.map((item, index) => <li key={index}>{item}</li>)}</ol>;
}

function Warn({ children }: { children: ReactNode }) {
  return <p className="setup-warn">{children}</p>;
}

function buildSteps(status: ConnectionStatus): Step[] {
  const serverState: StepState = status.server === 'todo' ? 'todo' : status.reachable;
  const afterCore = (state: StepState): StepState => (coreReady(status) ? state : 'unknown');
  return [
    {
      id: 'server',
      title: 'サーバーをつなぐ',
      minutes: '約15分',
      state: serverState,
      ready: 'サーバーに接続できています。',
      todo: status.server === 'todo'
        ? '今は「この端末だけ」で動いています。AI・自動で探す・X/Instagram連携にはサーバーが必要です。'
        : status.error || 'サーバーに接続できません。',
      body: <>
        <p className="setup-lead">APIキーを安全に預かる、あなた専用の小さなサーバーを Cloudflare（無料）に置きます。1回だけの作業です。</p>
        <Sub title="A. Cloudflareの鍵を作る">
          <Steps items={[
            <>dash.cloudflare.com にログイン（アカウントがなければ無料で作成）。</>,
            <>右上の人のアイコン →「プロファイル」→「API トークン」→「トークンを作成」。</>,
            <>「Cloudflare Workers を編集する」の「テンプレートを使用」を押す。</>,
            <>「権限」に行を追加して「アカウント / D1 / 編集」を選ぶ →「概要に進む」→「トークンを作成」。表示されたトークンをコピー（1回しか表示されません）。</>,
            <>Cloudflareのトップ画面右側（または Workers の画面）にある「アカウント ID」もコピー。</>,
          ]} />
        </Sub>
        <Sub title="B. GitHubに鍵を預けてサーバーを作る">
          <Steps items={[
            <>GitHub のこのリポジトリ →「Settings」→「Secrets and variables」→「Actions」→「New repository secret」。</>,
            <>Name に <code>CLOUDFLARE_API_TOKEN</code>、Secret にAのトークンを入れて保存。もう1つ <code>CLOUDFLARE_ACCOUNT_ID</code> にアカウントIDを保存。</>,
            <>「Actions」タブ → 左の「Deploy Worker to Cloudflare」→「Run workflow」→ 緑の「Run workflow」。2〜3分で緑の✓になれば完成です。</>,
            <>Cloudflare →「Workers & Pages」→「social-mission-api」を開き、表示される <code>https://social-mission-api.〇〇.workers.dev</code> をコピー。</>,
          ]} />
        </Sub>
        <Sub title="C. アプリにサーバーの場所を教える">
          <p>このアプリは <code>{appUrl()}</code> で動いています。</p>
          <Steps items={[
            <><b>URLが workers.dev の場合</b>: Cloudflare →「Workers & Pages」→「sns-providers」→「設定」→「ビルド」→「変数とシークレット」に、名前 <code>VITE_API_BASE_URL</code>・値 Bでコピーしたサーバーのアドレス を追加 →「デプロイ」画面で再デプロイ。</>,
            <><b>URLが github.io の場合</b>: GitHub →「Settings」→「Secrets and variables」→「Actions」→「Variables」タブ →「New repository variable」に同じ内容を追加 →「Actions」→「Deploy PWA to Pages」→「Run workflow」。</>,
            <>ホーム画面のアプリを上にスワイプして完全に終了し、開き直す。ここが ✓ になれば完了。</>,
          ]} />
        </Sub>
      </>,
    },
    {
      id: 'key',
      title: '個人管理キーを作る',
      minutes: '約3分',
      state: status.key,
      ready: 'この端末にキーが保存されています。',
      todo: 'あなた専用のパスワードです。これがないとサーバー機能は動きません。',
      body: <>
        <p className="setup-lead">サーバーのアドレスは誰でも見られるので、あなた以外が使えないように合言葉を決めます。下のボタンで自動で作れます。</p>
        <PersonalKeyMaker />
      </>,
    },
    {
      id: 'ai',
      title: 'AIを使えるようにする',
      minutes: '約5分・無料',
      state: afterCore(status.ai),
      ready: 'AIが候補の評価と、いいね・返信の文案づくりに使われます。',
      todo: 'AIキーが未設定です。簡易評価だけで動き、返信文案は作られません。',
      body: <>
        <p className="setup-lead">AIには Groq（グロック）の無料枠を使います。クレジットカードは不要です。</p>
        <Steps items={[
          <>console.groq.com を開き、Googleアカウントなどでログイン。</>,
          <>左のメニュー「API Keys」→「Create API Key」→ 名前（例: social-mission）を入れて作成 → 表示されたキー（gsk_…）をコピー。</>,
          <>Cloudflare →「Workers & Pages」→「social-mission-api」→「設定」→「変数とシークレット」→「追加」。種類「シークレット」、名前 <code>GROQ_API_KEY</code>、値に貼り付けて「デプロイ」。</>,
          <>このカードの「再確認」を押して ✓ になれば完了。</>,
        ]} />
        <Sub title="AIの使い方（準備ができたら）">
          <ul className="setup-bullets">
            <li><b>探す →「新しい候補を探す」</b>: 目的に合う人を見つけて、相性の良い順に並べます。</li>
            <li><b>探す →「候補情報を更新・再評価」→「候補をAIで再評価」</b>: いいね・返信・フォローのどれが良いかと、返信の文案を作り直します。</li>
            <li><b>今日</b>: AIの返信文案がカードに出ます。直してからコピー、または承認して送信。</li>
            <li><b>自分 →「今の発信を分析する」</b>: プロフィールと投稿を貼ると、改善案が出ます。</li>
          </ul>
        </Sub>
      </>,
    },
    {
      id: 'discovery',
      title: '候補を自動で探す',
      minutes: '約5分・無料',
      state: afterCore(status.discovery),
      ready: 'アプリを開くたびに、目的に合う相手が自動で補充されます。',
      todo: '自動探索が未設定です。「今すぐ探す」のキーワード検索と手動追加は使えます。',
      body: <Steps items={[
        <>app.tavily.com を開き、無料アカウントを作成（毎月の無料枠あり）。</>,
        <>ダッシュボードの「API Keys」にあるキー（tvly-…）をコピー。</>,
        <>Cloudflare の「変数とシークレット」に、シークレット <code>TAVILY_API_KEY</code> を追加して「デプロイ」。</>,
        <>アプリを開き直すと、候補が足りないときに自動で探して、AIで並べ替えまで行います。</>,
      ]} />,
    },
    {
      id: 'x',
      title: 'Xと連携する',
      minutes: '約30分・従量課金',
      state: afterCore(status.x),
      ready: 'Xと接続済みです。メンションや返信が「今日」に届きます。',
      todo: status.x === 'partial'
        ? 'サーバー側の準備はできています。下の「Xを読み取り専用で接続」を押してください。'
        : 'Xの開発者アプリが未設定です。',
      optional: true,
      body: <>
        <p className="setup-lead">いちばん手順が多いところです。上から順に進めれば大丈夫です。</p>
        <Warn>X API は使った分だけ支払う「従量課金」です（無料枠はありません）。先にクレジットを少額（例: $5）だけ買い、<b>自動チャージはオフ</b>にしておけば、それ以上は絶対に請求されません。</Warn>
        <Sub title="X連携でできること・できないこと">
          <ul className="setup-bullets">
            <li>✓ 自分のプロフィール・投稿・フォロワーをAIが分析（自分のデータ: 1件 約$0.001）</li>
            <li>✓ 自分へのメンション・返信を「今日」に取り込み、AIが返信案を作る</li>
            <li>✓ 承認した返信だけアプリから送信（1件 約$0.015）</li>
            <li>✕ フォロー・いいねのアプリ内実行（2026年4月から企業向け契約のみ）→ ボタンを押すとXアプリが開くので、そこで行います</li>
          </ul>
        </Sub>
        <Sub title="① 開発者アカウントを作る">
          <Steps items={[
            <>パソコンで console.x.com を開き、連携したいXアカウントでログイン。</>,
            <>開発者の利用規約に同意し、使い道（例: 「自分のアカウントの交流管理に使う個人用アプリ」）を入力。</>,
          ]} />
        </Sub>
        <Sub title="② クレジットを入れる">
          <Steps items={[
            <>コンソールの「Billing / 請求」→「Credits」でクレジットを購入（まずは $5 がおすすめ）。</>,
            <>「Auto-recharge（自動チャージ）」がオフになっていることを確認。</>,
          ]} />
        </Sub>
        <Sub title="③ アプリを作る">
          <Steps items={[
            <>「Apps」→「Create App / 新しいアプリ」。名前は何でもOK（例: social-mission-あなたの名前）。</>,
            <>環境は「Production」、パッケージは「Pay-per-use」を選ぶ。</>,
          ]} />
        </Sub>
        <Sub title="④ ログインの設定（User authentication settings）">
          <Steps items={[
            <>作ったアプリの「Settings / 設定」→「User authentication settings」→「Set up / 編集」。</>,
            <>App permissions: 「Read」（返信も使うなら「Read and write」、DMも使うなら「Read and write and Direct message」）。</>,
            <>Type of App: 「Web App, Automated App or Bot」（Confidential client）。</>,
            <>Callback URI と Website URL に、下の値をコピーして貼る → 保存。</>,
          ]} />
          <XSetupValues />
        </Sub>
        <Sub title="⑤ Client ID と Client Secret をもらう">
          <Steps items={[
            <>アプリの「Keys and tokens / キーとトークン」→「OAuth 2.0 Client ID and Client Secret」。</>,
            <>Client ID と Client Secret をコピー（Secret は1回しか表示されません。消えたら「Regenerate」で作り直し）。</>,
          ]} />
        </Sub>
        <Sub title="⑥ サーバーに登録する">
          <p>Cloudflare →「social-mission-api」→「設定」→「変数とシークレット」で、種類「シークレット」として次の5つを追加し「デプロイ」。</p>
          <ul className="setup-bullets">
            <li><code>X_CLIENT_ID</code> と <code>X_CLIENT_SECRET</code>（⑤の値）</li>
            <li><code>X_OAUTH_CALLBACK_URL</code>・<code>PWA_RETURN_URL</code>・<code>OAUTH_TOKEN_ENCRYPTION_KEY_B64</code>（④の下に表示した値）</li>
          </ul>
        </Sub>
        <Sub title="⑦ アプリからXにログインする">
          <Steps items={[
            <>このカードの「再確認」→「Xと連携する」が「あと少し」になればOK。</>,
            <>下の「キー入力・X接続を開く」→「Xを読み取り専用で接続」。Xの画面で「アプリにアクセスを許可」。</>,
            <>アプリに戻って「Xと接続中」と出れば接続完了。</>,
          ]} />
        </Sub>
        <Sub title="⑧ 読み取りをオンにする（料金の登録）">
          <p>料金を登録しないと、安全のためXのデータは読みに行きません。Cloudflare の「変数とシークレット」に、種類「テキスト」で追加します。</p>
          <XPriceTable kind="read" />
          <p>登録後、「アプリ・SNS・クラウド接続」→「Xの情報を更新」「メンション/返信を取り込む」が使えます。アプリを開くと15分おきに新しいメンションを自動で確認します。</p>
        </Sub>
        <Sub title="⑨ 返信・DMをアプリから送る（任意）">
          <Steps items={[
            <>「Xをつなぐ」→「できることを増やす」→「返信権限を追加」（DMも使うなら「DM権限を追加」）。Xの画面で許可。</>,
            <>Cloudflare に次の値を追加して「デプロイ」。</>,
          ]} />
          <XPriceTable kind="write" />
          <p>DMも使う場合:</p>
          <XPriceTable kind="dm" />
          <Warn>送信は必ず1件ずつ、あなたが「承認」したときだけです。URLを含む返信は料金が高い（1件 約$0.20）ため、アプリからは送らずXアプリに任せます。</Warn>
        </Sub>
        <Sub title="月にいくらかかる？（目安）">
          <ul className="setup-bullets">
            <li>自分のデータ更新（フォロワー等 約200件）: 1回 約$0.2 → アプリが月の予算内で自動調整</li>
            <li>メンション取り込み: 新着10件で 約$0.05</li>
            <li>返信 1件 約$0.015 → 100件で 約$1.5</li>
          </ul>
          <p>アプリの月間予算（設定 →「予算と整理ルール」、初期 $3）を超える処理はアプリ側でも止まります。</p>
        </Sub>
      </>,
    },
    {
      id: 'instagram',
      title: 'Instagramと連携する',
      minutes: '約30分・無料',
      state: afterCore(status.instagram),
      ready: 'Instagramと接続済みです。自分の投稿へのコメントが「今日」に届きます。',
      todo: status.instagram === 'partial'
        ? 'トークンが無効か権限が足りません。トークンを再発行してください。'
        : 'Instagram連携が未設定です。',
      optional: true,
      body: <>
        <p className="setup-lead">自分の投稿に付いたコメントやDMを取り込んで、返信候補にします。</p>
        <Steps items={[
          <>Instagramアプリ → プロフィール →「≡」→「アカウントの種類とツール」→「プロアカウントに切り替える」（クリエイターがおすすめ）。</>,
          <>パソコンで developers.facebook.com →「マイアプリ」→「アプリを作成」→ 用途「Instagramでメッセージとコンテンツを管理」を選ぶ。</>,
          <>「Instagram」→「Instagramログインによる API 設定」→「アカウントを追加」で自分のアカウントを追加し、「トークンを生成」。</>,
          <>Cloudflare にシークレット <code>INSTAGRAM_ACCESS_TOKEN</code>（生成したトークン）、<code>INSTAGRAM_USER_ID</code>（同じ画面のID）、<code>INSTAGRAM_API_VERSION</code>（例 v24.0）を追加して「デプロイ」。</>,
          <>「アプリ・SNS・クラウド接続」→ Instagram →「権限状態を確認」→「コメント反応を更新」。</>,
        ]} />
        <Warn>Instagramの公式APIでは、他人へのフォローや、他人の投稿へのいいねはできません。その場合はInstagramアプリが開きます。コメントへの返信をアプリから送るには <code>SOCIAL_WRITE_ENABLED=true</code>・<code>INSTAGRAM_COMMENT_REPLY_ENABLED=true</code>・<code>INSTAGRAM_COMMENT_REPLY_USD=0</code> を追加します。</Warn>
      </>,
    },
  ];
}

const stateLabel: Record<StepState, string> = { ready: '完了', todo: '未設定', partial: 'あと少し', unknown: '' };
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
  const firstTodo = steps.find((step) => step.state === 'todo' || step.state === 'partial');

  return <section className="setup-guide" aria-labelledby="setup-guide-title">
    <div className="setup-guide-head">
      <div>
        <span className="section-kicker">AI・SNS連携</span>
        <h2 id="setup-guide-title">{allRequiredReady ? 'AIは使える状態です' : '連携の準備をする'}</h2>
        <p>{doneCount}/{steps.length} 完了。タップすると手順が開きます。上から順に進めてください。</p>
      </div>
      <button type="button" className="secondary-button" disabled={status.checking} onClick={() => void refresh()}>{status.checking ? '確認中…' : '再確認'}</button>
    </div>
    <div className="setup-progress" aria-hidden="true"><span style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }} /></div>
    <ol className="setup-steps">
      {steps.map((step, index) => (
        <li key={step.id} className={`setup-step is-${step.state}`}>
          <details open={step === firstTodo}>
            <summary>
              <span className="setup-step-icon" aria-hidden="true">{step.state === 'ready' ? '✓' : step.state === 'unknown' ? index + 1 : stateIcon[step.state]}</span>
              <span className="setup-step-copy">
                <strong>{step.title}{step.optional && <em>必要なら</em>}</strong>
                <small>{step.state === 'ready' ? step.ready : step.state === 'unknown' ? `上の手順のあとに確認できます · ${step.minutes}` : `${step.todo} · ${step.minutes}`}</small>
              </span>
              {stateLabel[step.state] && <span className="setup-step-state">{stateLabel[step.state]}</span>}
            </summary>
            <div className="setup-step-body">{step.body}</div>
          </details>
        </li>
      ))}
    </ol>
    {status.server === 'ready' && <CopyField label="いまのサーバー" value={serverUrl()} />}
    <div className="setup-guide-actions">
      <button type="button" className="secondary-button" onClick={openConnectionSettings}>キー入力・X接続を開く</button>
      <a className="text-button" href={SETUP_GUIDE_URL} target="_blank" rel="noopener noreferrer">同じ手順をブラウザで見る</a>
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
      ? 'AI分析を使うには、先に「連携の準備」の①②が必要です。'
      : 'いまは「この端末だけ」で動いています。AIによる候補探し・いいね/返信の文案・X/Instagram連携は、設定の「連携の準備」を済ませると使えます。'
    : status.ai === 'todo'
      ? 'AIキーが未設定のため、簡易評価のみで返信文案は作られません。'
      : '自動の候補探しが未設定です。下の「今すぐ探す」や手動追加は使えます。';
  return <section className="setup-banner" role="note">
    <span aria-hidden="true">i</span>
    <p>{message}</p>
    <button type="button" onClick={onOpenSettings}>準備する</button>
  </section>;
}
