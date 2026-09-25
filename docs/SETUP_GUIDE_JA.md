# 連携セットアップガイド（AI・X・Instagram）

アプリの **設定 →「連携の準備」** に出る6つの手順を、ここで詳しく説明します。
上から順に進めてください。手順を終えるたびにアプリで「再確認」を押すと ✓ が付きます。

| 手順 | 必須？ | 使えるようになること | 費用の目安 |
| --- | --- | --- | --- |
| 1. サーバーをつなぐ | 必須 | AI・自動探索・X/Instagram連携すべての土台 | Cloudflare無料枠 |
| 2. 個人管理キー | 必須 | 他人にサーバーを使われないためのパスワード | 無料 |
| 3. AIを有効にする | おすすめ | 相性スコア、いいね・返信・フォローの提案、返信文案、自己分析 | Groq無料枠 |
| 4. 候補を自動で探す | おすすめ | アプリを開くと、目的に合う相手が自動で並ぶ | Tavily無料枠 |
| 5. X連携 | 必要なら | 自分の投稿・フォロー関係の読み取り、メンション/返信の取り込み | X APIは有料プランが必要な場合あり |
| 6. Instagram連携 | 必要なら | 自分の投稿へのコメント・DMを「今日」に取り込み、返信 | 無料（Metaの審査が必要な場合あり） |

> サーバーがなくても、**「探す」→「今すぐ探す」** でキーワードからX・Instagramの公式検索を開けます。
> いいね・返信したい投稿や、つながりたい人をすぐ探せます。

---

## 1. サーバーをつなぐ

このアプリには、APIキーを安全に預かる小さなサーバー（`worker/` フォルダ、Cloudflare Worker）が付いています。

1. [Cloudflare](https://dash.cloudflare.com/) にログインし、右上のアカウント → **My Profile → API Tokens → Create Token** で
   「Edit Cloudflare Workers」テンプレートから作成します。権限に **D1: Edit** も追加してください。
2. Cloudflareのダッシュボード右側に出ている **Account ID** を控えます。
3. GitHubのこのリポジトリで **Settings → Secrets and variables → Actions → New repository secret** から次の2つを登録します。
   - `CLOUDFLARE_API_TOKEN` … 1で作ったトークン
   - `CLOUDFLARE_ACCOUNT_ID` … 2のAccount ID
4. GitHubの **Actions → Deploy Worker to Cloudflare → Run workflow** を押します。
   データベース（D1）も自動で作られ、サーバーが公開されます。
5. Cloudflareの **Workers & Pages → social-mission-api** を開き、`https://social-mission-api.<あなたの名前>.workers.dev` のURLを控えます。
6. アプリ本体にサーバーのURLを教えます（アプリをどこで公開しているかで場所が違います）。
   - **Cloudflare（Worker `sns-providers`）で公開している場合**: `sns-providers` → **Settings → Build → Variables and secrets** に
     `VITE_API_BASE_URL` = 5のURL を追加し、再デプロイ（Deployments → Retry / 次のpushで自動）。
   - **GitHub Pages で公開している場合**: リポジトリの **Settings → Secrets and variables → Actions → Variables** に
     `VITE_API_BASE_URL` = 5のURL を追加し、**Actions → Deploy PWA to Pages → Run workflow**。
     （Pagesを初めて使うときは **Settings → Pages → Source** を「GitHub Actions」にしてください）
7. ホーム画面のアプリを完全に閉じて開き直します。「サーバーをつなぐ」に ✓ が付けば完了です。

## 2. 個人管理キーを保存

サーバーのURLは公開されるので、あなた以外が使えないように「個人管理キー」を決めます。

1. 長いランダムな文字列を1つ作ります（パスワード管理アプリの生成機能がおすすめ。30文字以上）。
2. その文字列の SHA-256 値を作ります。Mac/Linux のターミナルなら:
   ```bash
   printf '%s' 'ここに1の文字列' | shasum -a 256
   ```
   表示された64文字（スペースより前）を使います。
3. Cloudflareの **social-mission-api → Settings → Variables and Secrets → Add** で
   種類「Secret」、名前 `SYNC_TOKEN_SHA256`、値に2の64文字を入れて保存します。
4. アプリの **設定 →「アプリ・SNS・クラウド接続」→ 個人管理キー** に **1の元の文字列** を入れて「キーを確認・保存」。

> 以降、Cloudflareに「シークレットを登録」と書いてあるものは、すべてこの3と同じ画面で追加します。

## 3. AIを有効にする

1. [Groq Console](https://console.groq.com/keys) でAPIキーを作成します（無料枠あり）。
2. Cloudflareのシークレットに `GROQ_API_KEY` として登録します。
3. アプリで「再確認」→「AIを有効にする」に ✓。

**AIの使いどころ**

- **探す →「新しい候補を探す」**: 目的に合う人を探して相性順に並べます（手順4も必要）。
- **探す →「候補情報を更新・再評価」→「候補をAIで再評価」**: 相性スコア・おすすめ行動（いいね/返信/フォロー）・返信文案を作ります。
- **今日**: AIの返信文案がカードに出ます。編集 → コピー、または承認して実行。
- **自分 →「今の発信を分析する」**: プロフィールと最近の投稿を貼ると、改善案が出ます。

返信文案が不要なら、設定 →「予算と整理ルール」→「返信文案を自動で提案する」をオフにできます。

## 4. 候補を自動で探す

1. [Tavily](https://app.tavily.com/) でAPIキーを作成します（無料枠あり）。
2. Cloudflareのシークレットに `TAVILY_API_KEY` を登録し、変数 `TAVILY_BILLING_MODE` = `free` にします（`worker/wrangler.jsonc` の初期値も free です）。
3. これで、アプリを開くたびに候補が足りなければ自動補充 → AI評価まで行われます。
   「今日」には上から「返信 → いいね → フォロー」の順で、すぐやることが並びます。

## 5. X連携

1. [X Developer Portal](https://developer.x.com/) でプロジェクトとアプリを作ります。
2. アプリの **User authentication settings** で
   - App permissions: **Read**（返信などは後からアプリ内ボタンで追加）
   - Type of App: **Web App, Automated App or Bot**（Confidential client）
   - Callback URI: `https://（手順1-5のURL）/api/x/oauth/callback`
   - Website URL: アプリを開いているURL
3. **Keys and tokens** の OAuth 2.0 Client ID / Client Secret を控えます。
4. Cloudflareのシークレットに登録します。
   - `X_CLIENT_ID`, `X_CLIENT_SECRET`
   - `X_OAUTH_CALLBACK_URL` = 2のCallback URIと完全に同じ文字列
   - `PWA_RETURN_URL` = アプリを開いているURL（例 `https://sns-providers.<名前>.workers.dev/`）
   - `OAUTH_TOKEN_ENCRYPTION_KEY_B64` = 次のコマンドの結果: `openssl rand -base64 32`
5. アプリの **設定 →「アプリ・SNS・クラウド接続」→「Xを読み取り専用で接続」** を押し、Xでログインして許可します。
6. 返信・いいね・フォローもアプリから実行したい場合は、同じ画面の「返信権限を追加」などを押します。
   実際の送信を有効にするには `SOCIAL_WRITE_ENABLED=true` と各 `X_*_WRITE_ENABLED=true`、
   料金 `X_*_USD` の設定が必要です（詳しくは [MANUAL_GO_LIVE_CHECKLIST.md](./MANUAL_GO_LIVE_CHECKLIST.md)）。

> X APIの読み取り・書き込みは、Xの料金プランによっては有料です。料金が未設定の操作は安全のため実行されません。

## 6. Instagram連携

1. Instagramアプリで **プロアカウント（クリエイターまたはビジネス）** に切り替えます。
2. [Meta for Developers](https://developers.facebook.com/) でアプリを作成し、「Instagram」製品を追加します（Instagramログイン）。
3. 自分のアカウントでアクセストークンを発行します。権限は `instagram_business_basic`、
   コメント返信には `instagram_business_manage_comments`、DMには `instagram_business_manage_messages`。
4. Cloudflareのシークレットに登録します。
   - `INSTAGRAM_ACCESS_TOKEN` … 3のトークン
   - `INSTAGRAM_USER_ID` … Instagramのユーザー ID
   - `INSTAGRAM_API_VERSION` … Metaのドキュメントで現在のバージョン（例 `v23.0`）
5. アプリの **設定 →「アプリ・SNS・クラウド接続」→ Instagram →「権限状態を確認」** と「コメント反応を更新」。
6. アプリ内からコメント返信するには `SOCIAL_WRITE_ENABLED=true`、`INSTAGRAM_COMMENT_REPLY_ENABLED=true`、`INSTAGRAM_COMMENT_REPLY_USD=0` を設定します。

> Instagramの公式APIでは、他人へのフォローや任意の投稿へのいいねはできません。これらは公式アプリを開いて行います。

---

## うまくいかないとき

- **「サーバーに接続できませんでした」**: 手順1-6の `VITE_API_BASE_URL` が正しいか、末尾に余計な `/` やスペースがないか確認し、アプリを再ビルドしてください。
- **「キーを確認できませんでした」**: 手順2の SHA-256 を作るとき、文字列の前後に改行が入っていないか確認してください（`printf` を使えば入りません）。
- **設定 →「アプリ・SNS・クラウド接続」→「本番準備チェック」** を押すと、足りない設定が「次の作業」として表示されます。
