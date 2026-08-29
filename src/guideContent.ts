export interface GuideItem {
  term: string;
  desc: string;
}

export interface GuideSection {
  id: string;
  icon: string;
  eyebrow: string;
  title: string;
  paragraphs?: string[];
  steps?: string[];
  bullets?: string[];
  items?: GuideItem[];
}

export const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'what',
    icon: '◐',
    eyebrow: 'ABOUT',
    title: 'Social Missionって何？',
    paragraphs: [
      'あなたが決めた目的（Mission）に近づくために「誰と、どうつながるか」をAIと一緒に考える個人用アシスタントです。',
      'フォロー・いいね・返信・DM送信などの最終操作をアプリが代わりに行うことはありません。常に公式のX/Instagramアプリであなた自身が操作し、戻ってきて結果を記録する仕組みです。',
      'インストール直後は候補もつながりも空の状態から始まります。まずはSettingsでMissionを設定するところから始めてください。',
    ],
  },
  {
    id: 'tabs',
    icon: '▦',
    eyebrow: 'NAVIGATION',
    title: '5つのタブでできること',
    items: [
      { term: '⌂ Today', desc: '今日やるべき行動を優先順に並べた「Daily Queue」。ここから1つずつこなしていきます。' },
      { term: '✦ Discover', desc: '新しい候補を見つけて追加する場所。URL/@usernameでの手動追加が基本です。設定済みなら無料探索も使えます。AI再評価は任意です。' },
      { term: '◎ Relations', desc: '今つながっている・交流中の人の一覧。相互フォロー状況の記録や、整理（フォロー解除）候補の確認ができます。' },
      { term: '◐ Me', desc: '自分のプロフィールや投稿をAIがMission視点で分析し、改善案を提案します。' },
      { term: '⚙ Settings', desc: 'Mission・話し方の方針（Communication DNA）・月間予算・1日の行動量などAIの判断基準を設定します。バックアップや外部連携もここから。' },
    ],
  },
  {
    id: 'flow',
    icon: '➜',
    eyebrow: 'HOW TO USE',
    title: '基本の使い方の流れ',
    steps: [
      'Settingsで自分のMission（誰と、何のためにつながりたいか）を書く。',
      'Discoverを開き、プロフィールURL / @usernameを追加する。設定済みなら「Missionから無料で候補を探す」も使えます。候補はWorkerやAIがなくてもTodayに並びます。',
      '「候補をAIで再評価」は任意です。Mission一致度や返信案を足したいときだけ使います。有料呼び出しは必須ではありません。',
      'Todayを開き、Daily Queue（今日のおすすめ順リスト）を上から順に確認する。',
      '気になる候補をタップすると、下書きがある場合はコピーして公式のX / Instagramアプリが開きます。そこで実際にフォロー・返信などを行う。',
      'アプリに戻ると「〜はどうしました？」と聞かれるので、1タップで結果を選ぶ。ここで初めて関係性の記録が更新される。',
      'Relationsで相互フォローや整理候補を確認し、Meで自分のプロフィールも定期的に見直す。',
    ],
  },
  {
    id: 'safety',
    icon: '⚑',
    eyebrow: 'SAFETY & COST',
    title: '知っておきたい安全・コストの仕組み',
    bullets: [
      'フォロー・いいね・返信・DM送信をアプリが自動で行うことはありません。最終操作は必ずあなたが公式アプリで行います。',
      '月間のAI / API予算（初期設定 $3）を超える有料処理は実行されません（HARD LIMIT、常にON）。既定では $0 のままでも Today / 探す / 1タップ記録は使えます。',
      'サーバー機能（AI評価・X / Instagram連携・予算確認など）を使うときは「個人管理キー」で保護されます。Settings / Syncで設定した値は端末にのみ保存されるので、忘れずに控えてください。',
      '候補カードで「明日へ」を押しても関係の記録は消えません。翌日また候補として表示されるだけです。',
      'データは基本的に端末内（ローカル）に保存されます。他の端末へ移すときはJSONバックアップまたはD1同期を使います。',
    ],
  },
  {
    id: 'glossary',
    icon: '✎',
    eyebrow: 'GLOSSARY',
    title: '用語ミニ辞典',
    items: [
      { term: 'Mission', desc: 'あなたが決める「誰と、何のためにつながりたいか」という目的。すべてのAI判断の基準になります。' },
      { term: 'Mission Match', desc: '候補カードに表示されるスコア（0〜100）。その人がMissionにどれだけ近いかを表します。' },
      { term: 'Daily Queue', desc: 'Todayに表示される、今日やるべき行動の優先順リスト。Mission・関係性・1日の上限から自動で組まれます。返信カードには対象投稿と「この人とはN日空いている」も出ます。' },
      { term: 'Relationship Score / Stage', desc: '交流の積み重ねから育つ関係の深さ。discovered → interested → following → … → relationshipのように段階が進みます。' },
      { term: 'フォローバックレビュー', desc: '設定した日数が経っても相互フォローにならない相手を、整理候補として確認するタイミング。自動解除はしません。' },
      { term: 'HARD LIMIT', desc: '月間予算を超える有料AI / API呼び出しを絶対に実行しないための安全装置。' },
    ],
  },
];
