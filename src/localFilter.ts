import type { Candidate, Mission } from './types';

export function selectCandidatesForRanking(mission: Mission, candidates: Candidate[], max = 30) {
  if (candidates.length <= max) return candidates;
  const missionTokens = tokenSet(`${mission.primaryGoal} ${mission.text} ${mission.secondaryGoals.join(' ')} ${mission.communicationDNA}`);

  return candidates
    .map((candidate, index) => ({ candidate, index, score: localScore(candidate, missionTokens) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, Math.max(1, max))
    .map((entry) => entry.candidate);
}

function localScore(candidate: Candidate, missionTokens: Set<string>) {
  const text = [candidate.displayName, candidate.bio, candidate.tags.join(' '), candidate.kind].join(' ');
  const candidateTokens = tokenSet(text);
  let overlap = 0;
  for (const token of candidateTokens) if (missionTokens.has(token)) overlap += 1;
  const union = new Set([...missionTokens, ...candidateTokens]).size || 1;
  const similarity = overlap / union;

  const priorMatch = Math.max(0, Math.min(100, candidate.match || 0)) / 100;
  const contextCompleteness = Math.min(1, (candidate.bio.trim().length + candidate.tags.join('').length) / 180);
  const relationshipBoost = ['engaged', 'recognized', 'conversation', 'relationship'].includes(candidate.stage) ? 0.16 : 0;
  const actionBoost = candidate.recommendedAction === 'reply' || candidate.recommendedAction === 'dm' ? 0.14 : candidate.recommendedAction === 'unfollow_review' ? 0.08 : 0;

  return similarity * 0.5 + priorMatch * 0.24 + contextCompleteness * 0.1 + relationshipBoost + actionBoost;
}

function tokenSet(value: string) {
  const normalized = value.toLowerCase().normalize('NFKC');
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9][a-z0-9_+-]{1,}|[ぁ-んァ-ヶ一-龠々ー]{2,}/g) || []) {
    if (/^[ぁ-んァ-ヶ一-龠々ー]+$/.test(word)) {
      const compact = word.replace(/\s+/g, '');
      if (compact.length <= 3) tokens.add(compact);
      for (let index = 0; index < compact.length - 1; index += 1) tokens.add(compact.slice(index, index + 2));
    } else {
      tokens.add(word);
    }
  }
  return tokens;
}
