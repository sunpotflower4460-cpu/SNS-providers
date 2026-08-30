import { completeInboxAction, dismissInboxAction, recordInteraction } from './store';
import type { AppState, Candidate, Interaction, RecommendedAction, SocialAction } from './types';

export type ResultSheetAction = 'followed' | 'skipped' | 'later' | 'kept';

/**
 * Apply a result-sheet choice using the context the user actually saw when the
 * official social app was opened. The candidate may have been updated by an
 * async sync/restore while the sheet remained visible; that newer state must
 * not silently reinterpret the visible action or erase a newer recommendation.
 */
export function resolveVisibleResult(
  state: AppState,
  visibleCandidate: Candidate,
  action: ResultSheetAction,
  visibleSocialAction?: SocialAction,
): AppState {
  if (action === 'later') return state;
  const current = state.candidates.find((candidate) => candidate.id === visibleCandidate.id);
  if (!current || current.skipped) return state;
  if (!sameVisibleCandidateIdentity(visibleCandidate, current)) return state;
  if (visibleSocialAction) {
    const selected = (state.socialActions || []).find((item) => item.id === visibleSocialAction.id);
    if (!selected || selected.candidateId !== current.id) return state;
    if (action === 'skipped') return dismissInboxAction(state, selected.id);
    return completeInboxAction(state, selected.id);
  }

  const visibleCleanup = visibleCandidate.recommendedAction === 'unfollow_review';
  const visibleReview = visibleCandidate.recommendedAction === 'review';
  const visibleEngagement = ['like', 'reply', 'dm'].includes(visibleCandidate.recommendedAction);
  const sameVisibleAction = current.recommendedAction === visibleCandidate.recommendedAction;
  const sameVisibleTarget = visibleCandidate.recommendedAction === 'like' || visibleCandidate.recommendedAction === 'reply'
    ? Boolean(visibleCandidate.engagementUrl) && current.engagementUrl === visibleCandidate.engagementUrl
    : true;
  const completedVisibleEngagement = action === 'kept' && visibleEngagement && sameVisibleAction && sameVisibleTarget;

  const contextualAction: RecommendedAction = visibleCleanup
    ? 'unfollow_review'
    : current.recommendedAction === 'unfollow_review'
      ? 'review'
      : completedVisibleEngagement
        ? 'review'
        : current.recommendedAction;

  const needsContextPatch = contextualAction !== current.recommendedAction || completedVisibleEngagement;
  const contextualState: AppState = needsContextPatch
    ? {
        ...state,
        candidates: state.candidates.map((candidate) => candidate.id === current.id
          ? {
              ...candidate,
              recommendedAction: contextualAction,
              ...(completedVisibleEngagement ? {
                draft: undefined,
                engagementUrl: visibleCandidate.recommendedAction === 'like' || visibleCandidate.recommendedAction === 'reply'
                  ? undefined
                  : candidate.engagementUrl,
              } : {}),
            }
          : candidate),
      }
    : state;

  // A visible review is evidence that the user checked the profile/context, not that a
  // relationship interaction happened. Record it as review so CRM stage/score do not
  // advance merely from opening a profile. Specific like/reply/DM completions stay kept.
  const recordedAction: Interaction['action'] = visibleReview && action === 'kept'
    ? 'review'
    : action as Interaction['action'];
  return recordInteraction(contextualState, current.id, recordedAction);
}

function sameVisibleCandidateIdentity(visible: Candidate, current: Candidate) {
  if (visible.platform !== current.platform) return false;
  const visibleStableId = stablePlatformUserId(visible.platformUserId);
  const currentStableId = stablePlatformUserId(current.platformUserId);
  if (visibleStableId || currentStableId) {
    return Boolean(visibleStableId && currentStableId && visibleStableId === currentStableId);
  }
  return visible.username.toLowerCase() === current.username.toLowerCase();
}

function stablePlatformUserId(value?: string | null) {
  const id = value?.trim() || '';
  return /^\d{1,30}$/.test(id) ? id : '';
}
