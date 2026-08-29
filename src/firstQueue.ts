import { getSyncToken } from './controlToken';
import { apiConfigured } from './api';
import type { AppState } from './types';

export type FirstQueueTab = 'today' | 'discover' | 'relations' | 'me' | 'settings';

export interface FirstQueueStep {
  id: string;
  index: number;
  label: string;
  done: boolean;
  tab: FirstQueueTab;
}

export function firstQueueSteps(
  state: AppState,
  options: { apiConfigured: boolean; hasControlToken: boolean } = {
    apiConfigured,
    hasControlToken: Boolean(getSyncToken().trim()),
  },
): FirstQueueStep[] {
  const missionReady = Boolean(state.mission.text.trim() && state.mission.primaryGoal.trim());
  const workerReady = !options.apiConfigured || options.hasControlToken;
  const hasCandidates = state.candidates.some((candidate) => !candidate.skipped);
  const hasActionable = state.candidates.some((candidate) => {
    if (candidate.skipped) return false;
    if (candidate.recommendedAction === 'review' || candidate.recommendedAction === 'unfollow_review') return false;
    if ((candidate.recommendedAction === 'like' || candidate.recommendedAction === 'reply') && !candidate.engagementUrl) return false;
    return candidate.match > 0;
  });
  const synced = Boolean(state.xAccount.lastSyncedAt || state.instagramAccount?.lastSyncedAt);

  const steps: FirstQueueStep[] = [
    { id: 'mission', index: 1, label: '設定でMissionを確認する', done: missionReady, tab: 'settings' },
  ];
  if (options.apiConfigured) {
    steps.push({ id: 'key', index: steps.length + 1, label: '個人管理キーを保存する', done: workerReady, tab: 'settings' });
    steps.push({
      id: 'sync',
      index: steps.length + 1,
      label: synced ? 'X / Instagramを同期済み' : 'X同期・IGコメント同期、または無料探索',
      done: synced || hasCandidates,
      tab: 'discover',
    });
  } else {
    steps.push({
      id: 'local',
      index: steps.length + 1,
      label: '探すでURL / @usernameを追加する',
      done: hasCandidates,
      tab: 'discover',
    });
  }
  steps.push({
    id: 'rank',
    index: steps.length + 1,
    label: hasCandidates ? 'AIで候補を再評価してTodayへ並べる' : '候補が入ったらAI再評価する',
    done: hasActionable,
    tab: 'discover',
  });
  return steps;
}
