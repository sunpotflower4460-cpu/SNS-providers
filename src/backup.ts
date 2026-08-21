import type { AppState } from './types';

interface BackupEnvelope {
  format: 'social-mission-backup';
  version: 1;
  exportedAt: string;
  state: AppState;
}

export function downloadBackup(state: AppState) {
  const payload: BackupEnvelope = {
    format: 'social-mission-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `social-mission-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function readBackup(file: File): Promise<AppState> {
  if (file.size > 5_000_000) throw new Error('バックアップファイルが大きすぎます');
  const text = await file.text();
  const parsed = JSON.parse(text) as Partial<BackupEnvelope>;
  if (parsed.format !== 'social-mission-backup' || parsed.version !== 1 || !parsed.state) {
    throw new Error('Social Missionのバックアップ形式ではありません');
  }
  const state = normalizeAppState(parsed.state);
  validateAppState(state);
  return state;
}

export function normalizeAppState(state: AppState): AppState {
  return {
    ...state,
    xAccount: state.xAccount && typeof state.xAccount === 'object' ? state.xAccount : {},
  };
}

export function validateAppState(state: AppState) {
  if (!state.mission || typeof state.mission.text !== 'string') throw new Error('Missionデータが不正です');
  if (!Array.isArray(state.candidates) || !Array.isArray(state.interactions)) throw new Error('候補・交流データが不正です');
  if (!state.budget || typeof state.budget.monthlyLimitUsd !== 'number') throw new Error('予算データが不正です');
  if (!state.relationshipPolicy || typeof state.relationshipPolicy.followBackReviewAfterDays !== 'number') throw new Error('関係性ポリシーが不正です');
  if (!state.selfProfile || typeof state.selfProfile.profileText !== 'string') throw new Error('自己分析データが不正です');
  if (!state.xAccount || typeof state.xAccount !== 'object') throw new Error('Xアカウント同期データが不正です');
}
