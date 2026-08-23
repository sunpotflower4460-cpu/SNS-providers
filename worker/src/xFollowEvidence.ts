export interface TrackedXAccount {
  key: string;
  username: string;
  platformUserId?: string | null;
}

export interface FollowerIdentity {
  id: string;
  username: string;
}

export interface FollowCycleEvidence {
  complete: boolean;
  cycle: number;
  targetCount: number;
  seenKeys: string[];
  unseenKeys: string[];
}

interface TargetRow {
  target_key: string;
  platform_user_id: string | null;
  username: string;
  seen: number;
}

type NormalizedTarget = Required<Pick<TrackedXAccount, 'key' | 'username'>> & { platformUserId?: string | null };

const MAX_TARGETS = 500;
const INSERT_CHUNK = 80;

export async function prepareFollowCycleTargets(
  db: D1Database,
  userId: string,
  cycle: number,
  cursor: string | null,
  trackedAccounts: TrackedXAccount[] | undefined,
) {
  if (cursor !== null) return;
  const targets = normalizeTargets(trackedAccounts || []).slice(0, MAX_TARGETS);
  try {
    await db.prepare('DELETE FROM x_follow_cycle_targets WHERE user_id = ? AND cycle = ?').bind(userId, cycle).run();
    await db.prepare('DELETE FROM x_follow_cycle_targets WHERE user_id = ? AND cycle < ?').bind(userId, Math.max(0, cycle - 2)).run();
    if (!targets.length) return;

    const createdAt = new Date().toISOString();
    for (let offset = 0; offset < targets.length; offset += INSERT_CHUNK) {
      const chunk = targets.slice(offset, offset + INSERT_CHUNK);
      const values = chunk.map(() => '(?, ?, ?, ?, ?, 0, ?)').join(',');
      const args: unknown[] = [];
      for (const target of chunk) {
        args.push(userId, cycle, target.key, target.platformUserId || null, target.username, createdAt);
      }
      await db.prepare(
        `INSERT INTO x_follow_cycle_targets (user_id, cycle, target_key, platform_user_id, username, seen, created_at) VALUES ${values}`
      ).bind(...args).run();
    }
  } catch {
    // Partial/stale target rows must never survive a failed cycle initialization. If we
    // cannot invalidate them either, abort the sync rather than risk later negative proof.
    if (!(await invalidateCycle(db, userId, cycle))) {
      throw new Error('X follow evidence storage is unavailable');
    }
  }
}

export async function updateFollowCycleEvidence(
  db: D1Database,
  userId: string,
  cycle: number,
  followers: FollowerIdentity[],
  nextToken: string | null,
): Promise<FollowCycleEvidence | null> {
  try {
    const rows = await db.prepare(
      'SELECT target_key, platform_user_id, username, seen FROM x_follow_cycle_targets WHERE user_id = ? AND cycle = ?'
    ).bind(userId, cycle).all<TargetRow>();
    const targets = rows.results || [];
    if (!targets.length) return null;

    const followerIds = new Set(followers.map((item) => item.id).filter(Boolean));
    const followerUsernames = new Set(followers.map((item) => item.username.toLowerCase()).filter(Boolean));
    const newlySeen = targets.filter((target) => {
      if (target.seen) return false;
      if (target.platform_user_id && followerIds.has(target.platform_user_id)) return true;
      return followerUsernames.has(target.username.toLowerCase());
    });

    if (newlySeen.length) {
      const placeholders = newlySeen.map(() => '?').join(',');
      const updated = await db.prepare(
        `UPDATE x_follow_cycle_targets SET seen = 1 WHERE user_id = ? AND cycle = ? AND target_key IN (${placeholders})`
      ).bind(userId, cycle, ...newlySeen.map((target) => target.target_key)).run();
      // A successful SQL statement that updates fewer rows than expected is also unsafe:
      // a later final page could misclassify one of the missing writes as unseen.
      if (updated.meta.changes !== newlySeen.length) throw new Error('incomplete follow evidence update');
    }

    if (nextToken) {
      return {
        complete: false,
        cycle,
        targetCount: targets.length,
        seenKeys: [],
        unseenKeys: [],
      };
    }

    const completed = await db.prepare(
      'SELECT target_key, seen FROM x_follow_cycle_targets WHERE user_id = ? AND cycle = ?'
    ).bind(userId, cycle).all<{ target_key: string; seen: number }>();
    const completedRows = completed.results || [];
    if (!completedRows.length) return null;

    return {
      complete: true,
      cycle,
      targetCount: completedRows.length,
      seenKeys: completedRows.filter((row) => Boolean(row.seen)).map((row) => row.target_key),
      unseenKeys: completedRows.filter((row) => !row.seen).map((row) => row.target_key),
    };
  } catch {
    // Once any page's positive evidence fails to persist, invalidate the entire cycle.
    // Continuing with partially written rows could turn a person seen on that page into
    // a false "not following back" result when the final page is reached.
    if (!(await invalidateCycle(db, userId, cycle))) {
      throw new Error('X follow evidence storage is unavailable');
    }
    return null;
  }
}

async function invalidateCycle(db: D1Database, userId: string, cycle: number) {
  try {
    await db.prepare('DELETE FROM x_follow_cycle_targets WHERE user_id = ? AND cycle = ?').bind(userId, cycle).run();
    return true;
  } catch {
    return false;
  }
}

function normalizeTargets(input: TrackedXAccount[]): NormalizedTarget[] {
  const seen = new Set<string>();
  const result: NormalizedTarget[] = [];
  for (const raw of input) {
    const key = sanitizeKey(raw?.key || '');
    const username = sanitizeUsername(raw?.username || '');
    const platformUserId = sanitizePlatformUserId(raw?.platformUserId || '');
    if (!key || !username || seen.has(key)) continue;
    seen.add(key);
    result.push({ key, username, platformUserId: platformUserId || null });
  }
  return result;
}

function sanitizeKey(value: string) {
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{1,160}$/.test(trimmed) ? trimmed : '';
}

function sanitizeUsername(value: string) {
  const username = value.trim().replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : '';
}

function sanitizePlatformUserId(value: string) {
  const trimmed = value.trim();
  return /^\d{1,30}$/.test(trimmed) ? trimmed : '';
}
