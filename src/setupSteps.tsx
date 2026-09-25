import type { ReactNode } from 'react';
import type { ConnectionStatus } from './connectionStatus';
import { appUrl, CopyField, PersonalKeyMaker, serverUrl, XPriceTable, XSetupValues } from './setupHelpers';
import { startXOAuth } from './xAccount';

const REPO = 'https://github.com/sunpotflower4460-cpu/SNS-providers';

export type StepGroup = 'core' | 'x' | 'instagram';

export interface WizardStep {
  id: string;
  group: StepGroup;
  title: string;
  /** One line: why this step matters. */
  why: string;
  open?: { label: string; href: string };
  /** At most three short actions. */
  todo: string[];
  extra?: () => ReactNode;
  /** Automatic completion check. Steps without it are confirmed by the user. */
  done?: (status: ConnectionStatus) => boolean;
  /** When true, 「できた」 re-checks the server and only advances once done() passes. */
  verify?: boolean;
  /** Minutes, shown as a small hint. */
  minutes: number;
}

const serverDone = (status: ConnectionStatus) => status.server === 'ready' && status.reachable === 'ready';

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: 'cf-token',
    group: 'core',
    title: 'Cloudflareの鍵を作る',
    why: 'AIとSNS連携を動かすサーバーを、無料のCloudflareに置くための鍵です。',
    open: { label: 'Cloudflareを開く', href: 'https://dash.cloudflare.com/profile/api-tokens' },
    todo: [
      '「トークンを作成」→「Cloudflare Workers を編集する」の「テンプレートを使用」',
      '権限に「アカウント / D1 / 編集」を足して「トークンを作成」',
      '出てきたトークンと、画面右の「アカウントID」をメモ',
    ],
    done: serverDone,
    minutes: 5,
  },
  {
    id: 'gh-secrets',
    group: 'core',
    title: 'GitHubに鍵を預ける',
    why: 'GitHubが自動でサーバーを作れるように、さっきの2つを登録します。',
    open: { label: 'GitHubを開く', href: `${REPO}/settings/secrets/actions/new` },
    todo: [
      'Name に下の1つ目、Secret にトークンを貼って保存',
      'もう一度「New repository secret」で、2つ目にアカウントIDを保存',
    ],
    extra: () => <>
      <CopyField label="1つ目の Name" value="CLOUDFLARE_API_TOKEN" />
      <CopyField label="2つ目の Name" value="CLOUDFLARE_ACCOUNT_ID" />
    </>,
    done: serverDone,
    minutes: 3,
  },
  {
    id: 'gh-deploy',
    group: 'core',
    title: 'サーバーを作る',
    why: 'ボタン1つで、あなた専用のサーバーが出来上がります。',
    open: { label: 'GitHubを開く', href: `${REPO}/actions/workflows/deploy-worker.yml` },
    todo: [
      '右の「Run workflow」→ 緑の「Run workflow」',
      '2〜3分待って、緑の ✓ になればOK',
    ],
    done: serverDone,
    minutes: 3,
  },
  {
    id: 'app-url',
    group: 'core',
    title: 'アプリにサーバーをつなぐ',
    why: 'できたサーバーのアドレスを、このアプリに教えます。',
    open: { label: 'Cloudflareを開く', href: 'https://dash.cloudflare.com/?to=/:account/workers-and-pages' },
    todo: [
      '「social-mission-api」を開き、https://…workers.dev のアドレスをコピー',
      '「sns-providers」→ 設定 → ビルド → 変数 に下の名前でアドレスを追加 → 再デプロイ',
      'このアプリを完全に閉じて、開き直す',
    ],
    extra: () => <>
      <CopyField label="変数の名前" value="VITE_API_BASE_URL" />
      <p className="wizard-note">アプリの場所: {appUrl()}（github.io の場合は GitHub → Settings → Secrets and variables → Actions → Variables に追加します）</p>
    </>,
    done: serverDone,
    verify: true,
    minutes: 5,
  },
  {
    id: 'key',
    group: 'core',
    title: '合言葉（個人管理キー）を作る',
    why: 'あなた以外がサーバーを使えないようにする合言葉です。ボタンで自動で作れます。',
    open: { label: 'Cloudflareを開く', href: 'https://dash.cloudflare.com/?to=/:account/workers/services/view/social-mission-api/production/settings' },
    todo: [
      '下の「キーを自動で作る」を押す',
      '②の値を、Cloudflareに シークレット「SYNC_TOKEN_SHA256」として追加 →「デプロイ」',
      '③のボタンを押す',
    ],
    extra: () => <PersonalKeyMaker />,
    done: (status) => status.key === 'ready' && status.reachable === 'ready',
    verify: true,
    minutes: 3,
  },
  {
    id: 'ai',
    group: 'core',
    title: 'AIを使えるようにする（無料）',
    why: 'AIが相手を相性順に並べ、いいね・返信の文案を作ります。',
    open: { label: 'Groqを開く', href: 'https://console.groq.com/keys' },
    todo: [
      'ログインして「Create API Key」→ できたキー（gsk_…）をコピー',
      'Cloudflareの「変数とシークレット」に、シークレットとして下の名前で追加 →「デプロイ」',
    ],
    extra: () => <CopyField label="名前" value="GROQ_API_KEY" />,
    done: (status) => status.ai === 'ready',
    verify: true,
    minutes: 5,
  },
  {
    id: 'discovery',
    group: 'core',
    title: '相手を自動で探せるようにする（無料）',
    why: 'アプリを開くたびに、目的に合う相手が自動で並ぶようになります。',
    open: { label: 'Tavilyを開く', href: 'https://app.tavily.com/home' },
    todo: [
      'ログインして、表示されているキー（tvly-…）をコピー',
      'Cloudflareの「変数とシークレット」に、シークレットとして下の名前で追加 →「デプロイ」',
    ],
    extra: () => <CopyField label="名前" value="TAVILY_API_KEY" />,
    done: (status) => status.discovery === 'ready',
    verify: true,
    minutes: 5,
  },
  {
    id: 'x-account',
    group: 'x',
    title: 'X：開発者登録とクレジット',
    why: 'X の API は使った分だけ払う方式です。先に少額だけ入れておけば使いすぎません。',
    open: { label: 'Xの開発者ページを開く', href: 'https://console.x.com/' },
    todo: [
      'つなぎたいXアカウントでログインし、規約に同意',
      '「Billing」→「Credits」で $5 だけ購入',
      '「Auto-recharge（自動チャージ）」がオフか確認',
    ],
    done: (status) => status.x === 'ready' || status.x === 'partial',
    minutes: 10,
  },
  {
    id: 'x-app',
    group: 'x',
    title: 'X：アプリを作ってログイン設定',
    why: 'このアプリからXにログインできるようにします。',
    open: { label: 'Xの開発者ページを開く', href: 'https://console.x.com/' },
    todo: [
      '「Apps」→ 新しいアプリ（Production / Pay-per-use）',
      '「Settings」→「User authentication settings」: Web App、権限は Read and write',
      'Callback URI と Website URL に下の値を貼って保存 →「Keys and tokens」で Client ID / Secret をメモ',
    ],
    extra: () => <XSetupValues />,
    done: (status) => status.x === 'ready' || status.x === 'partial',
    minutes: 10,
  },
  {
    id: 'x-secrets',
    group: 'x',
    title: 'X：サーバーに登録',
    why: 'Xの鍵をサーバーに預けます（この端末には置きません）。',
    open: { label: 'Cloudflareを開く', href: 'https://dash.cloudflare.com/?to=/:account/workers/services/view/social-mission-api/production/settings' },
    todo: [
      'シークレットとして下の5つを追加（値は前の画面のメモ）',
      '「デプロイ」を押す',
    ],
    extra: () => <ul className="wizard-names">
      {['X_CLIENT_ID', 'X_CLIENT_SECRET', 'X_OAUTH_CALLBACK_URL', 'PWA_RETURN_URL', 'OAUTH_TOKEN_ENCRYPTION_KEY_B64'].map((name) => <li key={name}><code>{name}</code></li>)}
    </ul>,
    done: (status) => status.x === 'ready' || status.x === 'partial',
    minutes: 5,
  },
  {
    id: 'x-login',
    group: 'x',
    title: 'X：ログインする',
    why: 'ここを押すとXの確認画面が開きます。「許可」を押せば接続完了です。',
    todo: ['下の「Xでログイン」を押す', 'Xの画面で「アプリにアクセスを許可」'],
    extra: () => <button type="button" className="primary-button full" onClick={() => void startXOAuth('read')}>Xでログイン（読み取りのみ）</button>,
    done: (status) => status.x === 'ready',
    verify: true,
    minutes: 1,
  },
  {
    id: 'x-prices',
    group: 'x',
    title: 'X：読み取りをオンにする',
    why: '料金を登録した操作だけが動きます（登録がない操作は安全のため止まります）。',
    open: { label: 'Cloudflareを開く', href: 'https://dash.cloudflare.com/?to=/:account/workers/services/view/social-mission-api/production/settings' },
    todo: ['種類「テキスト」で下の値を追加 →「デプロイ」'],
    extra: () => <XPriceTable kind="read" />,
    minutes: 5,
  },
  {
    id: 'ig-account',
    group: 'instagram',
    title: 'Instagram：プロアカウントとMetaアプリ',
    why: '自分の投稿へのコメントやDMを取り込むために必要です。',
    open: { label: 'Metaの開発者ページを開く', href: 'https://developers.facebook.com/apps/' },
    todo: [
      'Instagramアプリでプロアカウント（クリエイター）に切り替え',
      '「アプリを作成」→ Instagramのメッセージとコンテンツを管理',
      '「Instagramログインによる API 設定」で自分を追加し「トークンを生成」',
    ],
    done: (status) => status.instagram === 'ready' || status.instagram === 'partial',
    minutes: 15,
  },
  {
    id: 'ig-secrets',
    group: 'instagram',
    title: 'Instagram：サーバーに登録',
    why: 'Instagramの鍵をサーバーに預けます。',
    open: { label: 'Cloudflareを開く', href: 'https://dash.cloudflare.com/?to=/:account/workers/services/view/social-mission-api/production/settings' },
    todo: ['シークレットとして下の3つを追加 →「デプロイ」'],
    extra: () => <>
      <ul className="wizard-names">
        <li><code>INSTAGRAM_ACCESS_TOKEN</code> … 生成したトークン</li>
        <li><code>INSTAGRAM_USER_ID</code> … 同じ画面のID</li>
        <li><code>INSTAGRAM_API_VERSION</code> … 例 v24.0</li>
      </ul>
      <p className="wizard-note">いまのサーバー: {serverUrl()}</p>
    </>,
    done: (status) => status.instagram === 'ready',
    verify: true,
    minutes: 5,
  },
];

export const GROUP_LABEL: Record<StepGroup, string> = {
  core: '基本の準備',
  x: 'Xとつなぐ',
  instagram: 'Instagramとつなぐ',
};

export function helpPrompt(step: WizardStep) {
  return [
    '「Social Mission」というスマホアプリの初期設定をしています。',
    `いま「${step.title}」という手順で、次のことをしようとしています。`,
    ...step.todo.map((line, index) => `${index + 1}. ${line}`),
    step.open ? `開くページ: ${step.open.href}` : '',
    'どこを押せばいいか分からないので、パソコンやスマホに詳しくない人向けに、画面の見た目も含めてやさしく1つずつ教えてください。',
  ].filter(Boolean).join('\n');
}
