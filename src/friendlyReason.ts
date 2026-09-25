/**
 * The Worker answers configuration problems in English with secret names. Turn the common
 * ones into plain Japanese with the next step, for display only. Unknown text passes through.
 */
const rules: Array<[RegExp, string]> = [
  [/Failed to fetch|NetworkError|Load failed|Worker API.*(timeout|タイムアウト)/i, 'サーバーにつながりませんでした。通信状態を確認するか、設定 →「連携の準備」で「サーバーをつなぐ」を確認してください。'],
  [/Invalid personal control authorization|Personal control authorization required/i, '個人管理キーが違います。設定 →「アプリ・SNS・クラウド接続」でキーを入れ直してください。'],
  [/Personal control token is not configured/i, 'サーバーに個人管理キー（SYNC_TOKEN_SHA256）が登録されていません。設定 →「連携の準備」②を行ってください。'],
  [/X_OWNED_READ_ELIGIBLE/, 'Xの自分のデータ取得がサーバーでオフです。Cloudflareに X_OWNED_READ_ELIGIBLE=true を登録してください（ガイド「X連携」手順⑧）。'],
  [/X_USER_READ_USD and X_OWNED_READ_USD/, 'Xの料金がサーバーに未登録のため、安全のため止めています。X_USER_READ_USD と X_OWNED_READ_USD を登録してください（ガイド「X連携」手順⑧）。'],
  [/X_INBOUND_SYNC_ENABLED/, 'Xのメンション取り込みがサーバーでオフです。X_INBOUND_SYNC_ENABLED=true を登録してください（ガイド「X連携」手順⑧）。'],
  [/X_INBOUND_READ_USD/, 'Xのメンション取り込みの料金が未登録です。X_INBOUND_READ_USD を登録してください（ガイド「X連携」手順⑧）。'],
  [/X_DM_READ_USD|X_DM_READ_ENABLED/, 'XのDM取り込みはサーバーでオフです。DM権限を追加し、X_DM_READ_ENABLED=true と X_DM_READ_USD を登録してください（ガイド「X連携」手順⑨）。'],
  [/X_BEARER_TOKEN|X_USER_READ_USD/, 'X公式情報の更新はサーバーで未設定です（X_BEARER_TOKEN と X_USER_READ_USD）。使わなくても他の機能は動きます。'],
  [/X account is not connected/i, 'Xがまだ接続されていません。設定 →「アプリ・SNS・クラウド接続」→「Xを読み取り専用で接続」を押してください。'],
  [/HARD LIMIT/i, '今月の予算上限に達したため、有料の処理を止めました。設定 →「予算と整理ルール」で上限を確認できます。'],
  [/Budget ledger|budget-ledger|D1 .*unavailable|no such table/i, 'サーバーのデータベースが未準備です。GitHub → Actions →「Migrate production D1」を実行してください。'],
  [/TAVILY_API_KEY/, '自動の候補探しはサーバーで未設定です（TAVILY_API_KEY）。「今すぐ探す」のキーワード検索は使えます。'],
  [/Only Tavily free-mode/i, '自動の候補探しは TAVILY_BILLING_MODE=free のときだけ動きます。Cloudflareの変数を確認してください。'],
  [/INSTAGRAM_ACCESS_TOKEN|Instagram token, professional user ID, and API version/i, 'Instagram連携がサーバーで未設定です。設定 →「連携の準備」⑥を行ってください。'],
  [/INSTAGRAM_DM_READ/, 'InstagramのDM取り込みはサーバーでオフです（INSTAGRAM_DM_READ_ENABLED / INSTAGRAM_DM_READ_USD）。'],
  [/not a Professional/i, 'Instagramがプロアカウントではありません。Instagramアプリでクリエイター/ビジネスに切り替えてください。'],
  [/messaging window has expired/i, 'InstagramのDMは、相手の最後のメッセージから24時間以内しか返信できません。Instagramアプリで返信してください。'],
  [/Live provider writes are not enabled|stays HANDOFF|Use HANDOFF/i, 'この操作はアプリ内送信がオフです。公式アプリを開いて行ってください。'],
  [/Billable social writes fail closed|WRITE_COST_UNKNOWN|Execution budget could not be accounted/i, 'この送信の料金がサーバーに未登録のため、安全のため止めました。公式アプリで行うか、料金を登録してください。'],
];

export function friendlyReason(message: string) {
  if (!message) return message;
  for (const [pattern, text] of rules) {
    if (pattern.test(message)) return text;
  }
  return message;
}
