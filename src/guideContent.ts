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
      'つながりたい相手を整理し、今日できることと結果を記録する個人用アプリです。',
      'まず「探す」で相手のプロフィールURLか@usernameを登録します。公式SNSで相手を確認したら、このアプリに戻って実際の結果を記録してください。',
      '初期状態ではデータはこの端末に保存され、SNSへの投稿やフォローは自動で行いません。目的は「設定」でいつでも変更できます。',
    ],
  },
  {
    id: 'tabs',
    icon: '▦',
    eyebrow: 'NAVIGATION',
    title: '5つのタブでできること',
    items: [
      { term: '⌂ Today', desc: '今日向き合う交流を優先順に並べる Mission Inbox。SocialActionがあればそちらを優先し、なければ従来の Daily Queue が残ります。' },
      { term: '✦ Discover', desc: 'プロフィールURLや@usernameから候補を手動登録できます。クラウド接続後は無料探索やAI再評価も使えます。' },
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
      '必要なら「設定」で目的を自分用に直す。',
      '「探す」でInstagramまたはXを選び、プロフィールURLか@usernameを登録する。',
      '「今日」または「探す」から公式プロフィールを開き、SNS側で相手を確認する。',
      'アプリに戻り、確認だけしたのか、フォローしたのかなど、実際の結果を選ぶ。',
      '「関係」で記録を確認し、「設定」からJSONバックアップを書き出して保管する。',
      'クラウド接続後は、候補の自動探索やAIによる評価も使える。',
    ],
  },
  {
    id: 'safety',
    icon: '⚑',
    eyebrow: 'SAFETY & COST',
    title: '知っておきたい安全・コストの仕組み',
    bullets: [
      'フォロー・いいね・返信・DM送信をアプリが自動で行うことはありません。書き込みは1件ずつ、あなたの明示的な承認が必要です。',
      '月間のAI / API予算（初期設定 $3）を超える有料処理は実行されません（HARD LIMIT、常にON）。',
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
      { term: 'Mission / 目的地', desc: 'あなたが決める「誰と、何のためにつながりたいか」。最優先の目的地がTodayの見出しになり、追加した目的地も候補選びとAI評価に使われます。' },
      { term: 'Mission Match', desc: '候補カードに表示されるスコア（0〜100）。その人がMissionにどれだけ近いかを表します。' },
      { term: 'Mission Inbox / SocialAction', desc: '今処理すべき1件の交流。Candidate（人）とは別に、返信・コメント・DM・フォロー確認などを表します。' },
      { term: 'Daily Queue', desc: 'SocialActionがまだない候補向けの、今日やるべき行動の優先順リスト。Mission Inboxの移行フォールバックです。' },
      { term: 'Relationship Score / Stage', desc: '交流の積み重ねから育つ関係の深さ。discovered → interested → following → … → relationshipのように段階が進みます。' },
      { term: 'フォローバックレビュー', desc: '設定した日数が経っても相互フォローにならない相手を、整理候補として確認するタイミング。自動解除はしません。' },
      { term: 'HARD LIMIT', desc: '月間予算を超える有料AI / API呼び出しを絶対に実行しないための安全装置。' },
    ],
  },
];
