# 連携セットアップガイド（AI・X・Instagram）

> アプリでは **設定 →「準備をはじめる」** を押すと、ここと同じ手順が **1画面に1ステップ** のポップアップで出ます。各画面の下にある「ChatGPTに聞く」「Claudeに聞く」を押すと、その手順についての質問文が入った状態で開きます。

ここでは、その手順を1つずつ詳しく説明します。
上から順に進めてください。アプリの案内では、手順を終えて「できた → 次へ」を押すと自動で確認されます。

| 手順 | 必須？ | 使えるようになること | 費用の目安 |
| --- | --- | --- | --- |
| 1. サーバーをつなぐ | 必須 | AI・自動探索・X/Instagram連携すべての土台 | Cloudflare無料枠 |
| 2. 個人管理キー | 必須 | 他人にサーバーを使われないためのパスワード | 無料 |
| 3. AIを有効にする | おすすめ | 相性スコア、いいね・返信・フォローの提案、返信文案、自己分析 | Groq無料枠 |
| 4. 候補を自動で探す | おすすめ | アプリを開くと、目的に合う相手が自動で並ぶ | Tavily無料枠 |
| 5. X連携 | 必要なら | 自分の投稿・フォロー関係の分析、メンション/返信の取り込み、返信の送信 | 従量課金（少額クレジットを先に購入） |
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

> アプリの「準備をはじめる」→「合言葉（個人管理キー）を作る」→ **「キーを自動で作る」** を押すと、1〜2がボタンだけで終わります（ターミナル不要）。

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
3. アプリの案内で「できた → 次へ」を押し、次に進めば完了。

**もう1つの無料枠（おすすめの追加）: さくらのAI Engine**
月3,000リクエストまで無料で、超えても自動では課金されません（速度が落ちるだけ）。登録すると、AIの評価とアプリ内AIヘルプで Groq より先に使われます。

- [さくらのAI Engine](https://ai.sakura.ad.jp/sakura-ai/ai-engine/) でアカウントを作り、APIキーを発行
- Cloudflareのシークレットに `SAKURA_AI_API_KEY` を登録
- 必要なら変数 `SAKURA_AI_MODEL`（初期値 `gpt-oss-120b`）と `SAKURA_AI_BASE_URL`（初期値 `https://api.ai.sakura.ad.jp/v1`）を、さくらの管理画面の表示に合わせて変更

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

## 5. X連携（いちばん丁寧に）

> アプリの **設定 →「Xとつなぐ」** を押すと、同じ手順に加えて
> **あなたのアプリ専用のURLや鍵が自動で表示され、コピーボタンで貼り付けられます。** スマホでアプリを開いたまま、パソコンで作業するのがおすすめです。

### まず知っておくこと

| 項目 | 内容 |
| --- | --- |
| 料金の仕組み | **従量課金**（使った分だけ）。無料枠はありません。先にクレジットを買い、そこから引かれます。 |
| 使いすぎ防止 | クレジットを少額（例: $5）だけ買い、**自動チャージ（Auto-recharge）をオフ**。これで $5 以上は請求されません。アプリ側の月間予算（初期 $3）でも止まります。 |
| できること | 自分のプロフィール・投稿・フォロワーの分析／メンション・返信の取り込みと返信案／承認した返信の送信／DM（任意） |
| できないこと | **フォロー・いいねのアプリ内実行**。2026年4月20日から、X の通常プランでは API でのフォロー・いいねができなくなりました（Enterprise 契約のみ）。アプリはこのとき X アプリを開くので、そこで行います。 |

**料金の目安（2026年9月時点。必ず Developer Console で最新を確認）**

| 操作 | 目安 |
| --- | --- |
| 自分のデータ（自分の投稿・フォロワー・フォロー中）を読む | 1件 $0.001 |
| 他人の投稿を読む（メンションなど） | 1件 $0.005 |
| プロフィールを読む | 1件 $0.01 |
| 投稿・返信する | 1件 $0.015（URL入りは $0.20 → アプリは URL 入り返信を送りません） |

例: 自分のデータ更新（約220件）1回 ≒ $0.23、返信100件 ≒ $1.5。

### ① 開発者アカウントを作る

1. パソコンで [console.x.com](https://console.x.com/) を開き、**連携したい X アカウント**でログイン。
2. 開発者規約に同意し、使い道を英語か日本語で入力（例: 「自分のアカウントの交流を管理する個人用アプリ。投稿は自分が1件ずつ承認したときだけ行う」）。

### ② クレジットを入れる

1. コンソールの **Billing（請求）→ Credits** でクレジットを購入（最初は $5 がおすすめ）。
2. **Auto-recharge（自動チャージ）がオフ**になっていることを確認。

### ③ アプリを作る

1. **Apps → Create App（新しいアプリ）**。名前は自由（例: `social-mission-yourname`）。
2. 環境は **Production**、パッケージは **Pay-per-use** を選ぶ。
   （ログインは成功するのにデータが読めないときは、ここが Pay-per-use / Production になっているか確認）

### ④ ログインの設定（User authentication settings）

1. 作ったアプリの **Settings → User authentication settings → Set up（編集）**。
2. **App permissions**
   - 読み取りだけ: `Read`
   - 返信も送る: `Read and write`
   - DMも使う: `Read and write and Direct message`
3. **Type of App**: `Web App, Automated App or Bot`（Confidential client）
4. **Callback URI / Redirect URL**: `https://（サーバーのURL）/api/x/oauth/callback`
   - 例: `https://social-mission-api.yourname.workers.dev/api/x/oauth/callback`
   - **1文字でも違うとログインできません**（`https`、末尾の `/` の有無も含めて）。アプリの画面からコピーしてください。
5. **Website URL**: アプリを開いている URL（例: `https://sns-providers.yourname.workers.dev/`）
6. 保存。

### ⑤ Client ID と Client Secret をもらう

1. アプリの **Keys and tokens → OAuth 2.0 Client ID and Client Secret**。
2. **Client ID** と **Client Secret** をコピーして安全な場所に控える。
   Client Secret は **1回しか表示されません**。なくしたら `Regenerate` で作り直し、サーバー側も更新します。

### ⑥ サーバー（Cloudflare）に登録する

Cloudflare → **Workers & Pages → social-mission-api → 設定 → 変数とシークレット → 追加**。種類は **シークレット**。

| 名前 | 値 |
| --- | --- |
| `X_CLIENT_ID` | ⑤の Client ID |
| `X_CLIENT_SECRET` | ⑤の Client Secret |
| `X_OAUTH_CALLBACK_URL` | ④-4 と**まったく同じ**文字列 |
| `PWA_RETURN_URL` | ④-5 と同じ（ログイン後に戻ってくる場所） |
| `OAUTH_TOKEN_ENCRYPTION_KEY_B64` | アプリの「自動で作る」ボタンで作った値（またはターミナルで `openssl rand -base64 32`） |

最後に **デプロイ** を押す。`OAUTH_TOKEN_ENCRYPTION_KEY_B64` は一度決めたら変えないでください（変えると X の再接続が必要）。

### ⑦ アプリから X にログインする

1. アプリの「Xとつなぐ」の案内で「できた → 次へ」が進めば⑥まで成功。
2. **設定 →「アプリ・SNS・クラウド接続」→「Xを読み取り専用で接続」**。
3. X の画面で **アプリにアクセスを許可**。アプリに戻り「@あなた と接続中」と出れば完了。

### ⑧ 読み取りをオンにする（料金の登録）

料金を登録しない操作は、**安全のため実行されません**。Cloudflare の「変数とシークレット」に種類 **テキスト** で追加してデプロイ。

| 名前 | 値 | 意味 |
| --- | --- | --- |
| `X_OWNED_READ_ELIGIBLE` | `true` | 自分のアカウントのデータを読む許可 |
| `X_OWNED_READ_USD` | `0.001` | 自分のデータ1件の料金 |
| `X_USER_READ_USD` | `0.01` | プロフィール1件の料金 |
| `X_LOOKUP_READ_USD` | `0.01` | 送信前の本人確認1回の料金 |
| `X_INBOUND_SYNC_ENABLED` | `true` | メンション・返信を「今日」に取り込む |
| `X_INBOUND_READ_USD` | `0.05` | 取り込み1回の見積もり（新着約10件分） |

- これで「Xの情報を更新」「メンション/返信を取り込む」が使えます。
- アプリを開いているあいだ、**15分おきに新しいメンションを自動確認**します（新着がなければほぼ費用はかかりません）。
- `X_INBOUND_READ_USD` はアプリ側の予算計算に使う「1回あたりの見積もり」です。メンションが多いアカウントは大きめ（例: `0.2`）にすると安全です。実際の請求は X のクレジットから引かれるので、②の少額クレジットが最終的な上限になります。

### ⑨ 返信・DM をアプリから送る（任意）

1. **設定 →「アプリ・SNS・クラウド接続」→ Xをつなぐ →「できることを増やす」→「返信権限を追加」**（DMも使うなら「DM権限を追加」）。X の画面で許可。
   - ④の App permissions が `Read` のままだと、ここで失敗します。先に `Read and write` に変更してください。
2. Cloudflare に種類 **テキスト** で追加してデプロイ:

| 名前 | 値 |
| --- | --- |
| `SOCIAL_WRITE_ENABLED` | `true` |
| `X_REPLY_WRITE_ENABLED` | `true` |
| `X_REPLY_WRITE_USD` | `0.015` |
| （DM）`X_DM_READ_ENABLED` | `true` |
| （DM）`X_DM_READ_USD` | `0.05` |
| （DM）`X_DM_WRITE_ENABLED` | `true` |
| （DM）`X_DM_WRITE_USD` | `0.015` |

3. 「今日」の返信カードで文案を確認 →「承認して送信」。**送信は必ず1件ずつ、あなたの承認のあとだけ**です。
4. URL を含む返信は料金が高い（約 $0.20）ため、アプリは送信せず「Xアプリで送ってください」と表示します。

### X でうまくいかないとき

| 症状 | 原因と対処 |
| --- | --- |
| 「Xを読み取り専用で接続」が押せない | ⑥のどれかが未登録。「本番準備チェック」で足りない名前が出ます。 |
| X の画面で「Something went wrong」 | Callback URI が一致していない（④-4 と `X_OAUTH_CALLBACK_URL`）。コピーし直してください。 |
| 接続後「X接続を完了できませんでした」 | `X_CLIENT_SECRET` の貼り間違い、または ③ が Pay-per-use / Production でない。 |
| 「Xの料金がサーバーに未登録」 | ⑧の値を登録してデプロイ。 |
| 「今月の予算上限に達した」 | 設定 →「予算と整理ルール」で月間予算を確認。または X のクレジット残高を確認。 |
| 返信権限の追加に失敗 | ④の App permissions を `Read and write` にしてから、もう一度。 |
| フォロー・いいねがアプリでできない | 仕様です（2026年4月からXの通常プランでは不可）。Xアプリで行ってください。 |

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
