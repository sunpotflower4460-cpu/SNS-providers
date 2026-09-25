import { useEffect, useRef, useState } from 'react';
import { askHelpChat, type HelpChatMessage } from './api';
import { friendlyReason } from './friendlyReason';
import { useModalA11y } from './useModalA11y';
import './wizard.css';

const STARTERS = [
  '最初に何をすればいいですか？',
  'AIはどう使えばいいですか？',
  'Xとつなぐには何が必要ですか？',
];

/** In-app help chat backed by the Worker's free-only /api/help/chat. */
export default function HelpChat({ initialQuestion, context, onClose }: { initialQuestion?: string; context: string; onClose: () => void }) {
  const [messages, setMessages] = useState<HelpChatMessage[]>([]);
  const [draft, setDraft] = useState(initialQuestion || '');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  // Set when the in-app AI could not answer (provider fallback, daily limit, request error),
  // so the external AI links are offered right inside the chat.
  const [externalQuestion, setExternalQuestion] = useState('');
  const containerRef = useModalA11y<HTMLElement>(onClose);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  async function send(text = draft) {
    const content = text.trim();
    if (!content || busy) return;
    const next: HelpChatMessage[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    setNote('');
    try {
      const result = await askHelpChat(next, context);
      setMessages([...next, { role: 'assistant', content: result.answer }]);
      setExternalQuestion(result.provider === 'fallback' || result.provider === 'limit' ? content : '');
      if (result.remaining != null && result.remaining <= 5) setNote(`今日はあと${result.remaining}回使えます`);
    } catch (error) {
      setNote(friendlyReason(error instanceof Error ? error.message : 'アプリ内AIにつながりませんでした'));
      setExternalQuestion(content);
    } finally {
      setBusy(false);
    }
  }

  return <div className="wizard-backdrop" onClick={onClose}>
    <section ref={containerRef} className="wizard-sheet help-chat" role="dialog" aria-modal="true" aria-label="アプリ内AIに聞く" tabIndex={-1} onClick={(event) => event.stopPropagation()}>
      <div className="wizard-head">
        <span>アプリ内AIに聞く</span>
        <button type="button" className="wizard-close" aria-label="閉じる" onClick={onClose}>×</button>
      </div>
      <div className="help-chat-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && <div className="help-chat-empty">
          <p>使い方や準備で分からないことを、ふつうの言葉で聞いてください。</p>
          <div>{STARTERS.map((starter) => <button type="button" key={starter} onClick={() => void send(starter)}>{starter}</button>)}</div>
          <small>パスワードやAPIキーは貼らないでください。</small>
        </div>}
        {messages.map((message, index) => <p key={index} className={message.role === 'user' ? 'help-chat-me' : 'help-chat-ai'}>{message.content}</p>)}
        {busy && <p className="help-chat-ai is-typing">考えています…</p>}
      </div>
      {note && <p className="wizard-note" role="status">{note}</p>}
      {externalQuestion && <div className="help-chat-external">
        <span>ほかのAIで聞く（質問文が入った状態で開きます・無料版でOK）</span>
        <div>
          <a href={`https://chatgpt.com/?q=${encodeURIComponent(externalPrompt(externalQuestion))}`} target="_blank" rel="noopener noreferrer">ChatGPTに聞く</a>
          <a href={`https://claude.ai/new?q=${encodeURIComponent(externalPrompt(externalQuestion))}`} target="_blank" rel="noopener noreferrer">Claudeに聞く</a>
        </div>
      </div>}
      <form className="help-chat-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="例: GitHubの画面で Run workflow が見つかりません" rows={2} maxLength={1500} />
        <button type="submit" className="primary-button" disabled={busy || !draft.trim()}>送る</button>
      </form>
    </section>
  </div>;
}

function externalPrompt(question: string) {
  return `「Social Mission」というスマホアプリ（XやInstagramでつながる相手をAIが探し、いいね・返信の文案を出すアプリ）について質問です。\n${question}\nスマホに詳しくない人向けに、やさしく1つずつ教えてください。`;
}
