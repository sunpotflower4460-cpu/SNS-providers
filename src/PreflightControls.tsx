import { useState } from 'react';
import { apiConfigured, fetchProductionPreflight } from './api';
import './preflight.css';

interface Check {
  ok?: boolean;
  severity?: 'ok' | 'warn' | 'block';
  label?: string;
  reason?: string;
  nextStep?: string;
}

export default function PreflightControls() {
  const [loading, setLoading] = useState(false);
  const [checks, setChecks] = useState<Check[]>([]);
  const [note, setNote] = useState(apiConfigured ? '本番準備の状態を確認できます' : 'Worker URLがないため本番準備チェックは使えません');

  async function run() {
    setLoading(true);
    try {
      const result = await fetchProductionPreflight();
      const list = Array.isArray(result.checks) ? result.checks as Check[] : [];
      setChecks(list);
      const summary = result.summary && typeof result.summary === 'object' ? result.summary as { block?: number; warn?: number; ok?: number } : {};
      setNote(`本番準備チェック: 問題なし ${summary.ok || 0} · 注意 ${summary.warn || 0} · 停止 ${summary.block || 0}`);
    } catch (error) {
      setChecks([]);
      setNote(error instanceof Error ? error.message : '本番準備チェックに失敗しました');
    } finally {
      setLoading(false);
    }
  }

  return <section className="form-card">
    <div className="field-title">
      <div><strong>本番準備チェック</strong><span>コードと接続の不足を、色だけでなく文章でも示します</span></div>
    </div>
    <button className="primary-button" disabled={loading || !apiConfigured} onClick={() => void run()}>{loading ? '確認中…' : '本番準備を確認'}</button>
    <small>{note}</small>
    {checks.length > 0 && <div className="preflight-list">
      {checks.map((check) => (
        <p key={check.label} className={`preflight-item ${check.severity || 'ok'}`}>
          <strong>{check.severity === 'block' ? '停止' : check.severity === 'warn' ? '注意' : '問題なし'} · {check.label}</strong>
          <span>{check.reason}</span>
          {check.nextStep && <span>次の作業: {check.nextStep}</span>}
        </p>
      ))}
    </div>}
  </section>;
}
