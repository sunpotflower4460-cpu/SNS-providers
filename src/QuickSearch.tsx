import { useState } from 'react';
import type { Mission } from './types';

const KEYWORDS_KEY = 'sns-providers:quick-search-keywords';
const MAX_KEYWORDS = 6;

/**
 * Zero-cost, zero-setup discovery: opens the official X / Instagram search for the
 * user's own keywords. Nothing is fetched or scraped by the app; the user browses in the
 * official app and likes/replies there, or copies a profile URL back into 候補を追加.
 */
export default function QuickSearch({ mission, compact = false }: { mission: Mission; compact?: boolean }) {
  const [text, setText] = useState(() => loadKeywords() ?? defaultKeywords(mission).join(' '));
  const keywords = parseKeywords(text);

  function update(value: string) {
    setText(value);
    try {
      localStorage.setItem(KEYWORDS_KEY, value);
    } catch {
      // Keywords are a convenience; the search links still work for this session.
    }
  }

  return <section className={compact ? 'quick-search is-compact' : 'quick-search'} aria-labelledby={compact ? undefined : 'quick-search-title'} aria-label={compact ? '今すぐ探す' : undefined}>
    <div className="quick-search-head">
      {!compact && <>
        <span className="section-kicker">設定なしで使える</span>
        <h2 id="quick-search-title">今すぐ探す</h2>
      </>}
      <p>キーワードでX・Instagramの公式検索を開きます。気になる投稿にはその場でいいね・返信、気になる人はプロフィールURLをコピーして「自分で候補を追加」へ。</p>
    </div>
    <label className="quick-search-input">キーワード（スペース区切り）
      <input value={text} onChange={(event) => update(event.target.value)} placeholder="例: 弾き語り 作曲 インディーズ" enterKeyHint="done" />
    </label>
    {keywords.length === 0
      ? <p className="quick-search-empty">キーワードを1つ以上入れると、検索ボタンが出ます。</p>
      : <ul className="quick-search-list">
        {keywords.map((keyword) => (
          <li key={keyword}>
            <strong>{keyword}</strong>
            <div className="quick-search-links">
              <a href={xSearchUrl(keyword, 'user')} target="_blank" rel="noopener noreferrer">Xで人を探す</a>
              <a href={xSearchUrl(keyword, 'live')} target="_blank" rel="noopener noreferrer">X最新投稿<small>いいね・返信向き</small></a>
              {instagramTag(keyword) && <a href={`https://www.instagram.com/explore/tags/${encodeURIComponent(instagramTag(keyword))}/`} target="_blank" rel="noopener noreferrer">Instagram #タグ</a>}
            </div>
          </li>
        ))}
      </ul>}
  </section>;
}

function xSearchUrl(keyword: string, mode: 'user' | 'live') {
  return `https://x.com/search?q=${encodeURIComponent(keyword)}&f=${mode}`;
}

function instagramTag(keyword: string) {
  return keyword.replace(/^#/, '').replace(/[\s　#]+/g, '').slice(0, 60);
}

function parseKeywords(text: string) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of text.split(/[\s　,、，]+/)) {
    const keyword = raw.trim().slice(0, 40);
    if (!keyword || seen.has(keyword.toLowerCase())) continue;
    seen.add(keyword.toLowerCase());
    result.push(keyword);
    if (result.length >= MAX_KEYWORDS) break;
  }
  return result;
}

function loadKeywords() {
  try {
    return localStorage.getItem(KEYWORDS_KEY);
  } catch {
    return null;
  }
}

/** Short destination labels ("アーティスト仲間") make usable first keywords. */
function defaultKeywords(mission: Mission) {
  return [mission.primaryGoal, ...mission.secondaryGoals]
    .map((goal) => goal.trim().replace(/(を|と)?(増やす|つながる|広げる|見つける|育てる)$/, ''))
    .filter((goal) => goal.length >= 2 && goal.length <= 10 && !/\s/.test(goal) && !/(つながり|関係|良質)/.test(goal))
    .slice(0, 3);
}
