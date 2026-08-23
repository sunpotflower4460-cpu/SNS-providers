import { recordInteraction } from './store';
import type { AppState, Candidate, Interaction, RecommendedAction } from './types';

export type ResultSheetAction = 'followed' | 'skipped' | 'later' | 'kept';

/**
 * Apply a result-sheet choice using the context the user actually saw when the
 * official social app was opened. The candidate may have been updated by an
 * async sync/restore while the sheet remained visible; that newer state must
 * not silently reinterpret "今回は見送る" as "フォロー解除した", or vice versa.
 */
export function resolveVisibleResult(
  state: AppState,
  visibleCandidate: Candidate,
  action: ResultSheetAction,
): AppState {
  if (action === 'later') return state;
  const current = state.candidates.find((candidate) => candidate.id === visibleCandidate.id);
  if (!current || current.skipped) return state;

  const visibleCleanup = visibleCandidate.recommendedAction === 'unfollow_review';
  const contextualAction: RecommendedAction = visibleCleanup
    ? 'unfollow_review'
    : current.recommendedAction === 'unfollow_review'
      ? 'review'
      : current.recommendedAction;

  const contextualState: AppState = contextualAction === current.recommendedAction
    ? state
    : {
        ...state,
        candidates: state.candidates.map((candidate) => candidate.id === current.id
          ? { ...candidate, recommendedAction: contextualAction }
          : candidate),
      };

  return recordInteraction(contextualState, current.id, action as Interaction['action']);
}
