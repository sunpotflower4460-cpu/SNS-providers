import type { AppState, Candidate, SocialAction } from './types';

const KEY = 'sns-providers:pending-handoff:v1';
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

interface PendingHandoff {
  candidateId: string;
  platform: Candidate['platform'];
  username: string;
  platformUserId?: string;
  recommendedAction: Candidate['recommendedAction'];
  engagementUrl?: string;
  identityConflict: boolean;
  actionId?: string;
  actionType?: SocialAction['type'];
  actionTargetUrl?: string;
  openedAt: number;
}

export function rememberPendingHandoff(candidate: Candidate, action?: SocialAction) {
  const pending: PendingHandoff = {
    candidateId: candidate.id,
    platform: candidate.platform,
    username: candidate.username,
    platformUserId: candidate.platformUserId,
    recommendedAction: candidate.recommendedAction,
    engagementUrl: candidate.engagementUrl,
    identityConflict: candidate.tags.includes('identity-conflict'),
    actionId: action?.id,
    actionType: action?.type,
    actionTargetUrl: action?.targetUrl,
    openedAt: Date.now(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingHandoff() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // The current sheet can still be dismissed when storage is unavailable.
  }
}

export function restorePendingHandoff(state: AppState): { candidate: Candidate; action?: SocialAction } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<PendingHandoff>;
    const candidate = state.candidates.find((item) => item.id === saved.candidateId);
    const age = Date.now() - (saved.openedAt ?? Number.NaN);
    const validCandidate = candidate
      && !candidate.skipped
      && candidate.platform === saved.platform
      && candidate.username.toLowerCase() === saved.username?.toLowerCase()
      && candidate.platformUserId === saved.platformUserId
      && candidate.recommendedAction === saved.recommendedAction
      && candidate.engagementUrl === saved.engagementUrl
      && candidate.tags.includes('identity-conflict') === saved.identityConflict;
    if (!validCandidate || !Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) {
      clearPendingHandoff();
      return null;
    }
    if (!saved.actionId) return { candidate };
    const action = state.socialActions.find((item) => item.id === saved.actionId);
    if (!action || action.candidateId !== candidate.id || action.type !== saved.actionType
      || action.targetUrl !== saved.actionTargetUrl
      || !['pending', 'ready', 'failed', 'executing'].includes(action.status)) {
      clearPendingHandoff();
      return null;
    }
    return { candidate, action };
  } catch {
    clearPendingHandoff();
    return null;
  }
}
