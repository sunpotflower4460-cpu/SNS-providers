import { runWithSourceLease } from '../syncLease';
import { syncInstagramComments } from './instagram/commentSync';
import { syncInstagramDirectMessages } from './instagram/dmSync';
import { syncXDirectMessages } from './x/dmSync';
import { syncXInboundMentions } from './x/sync';

type SourceResult = Record<string, unknown> & { status?: string; enabled?: boolean; reason?: string };

const SOURCE_LEASE_TTL_MS = 5 * 60 * 1000;

function wrap(result: SourceResult): SourceResult {
  if (result.status) return result;
  if (result.enabled === false) {
    return { ...result, status: result.source === 'error' ? 'error' : 'disabled' };
  }
  return { ...result, status: 'success' };
}

function isolatedError(reason: string): SourceResult {
  return { enabled: false, source: 'error', status: 'error', costUsd: 0, events: [], reason };
}

export interface InboxSyncAdapters {
  syncXInboundMentions?: typeof syncXInboundMentions;
  syncXDirectMessages?: typeof syncXDirectMessages;
  syncInstagramComments?: typeof syncInstagramComments;
  syncInstagramDirectMessages?: typeof syncInstagramDirectMessages;
}

export async function syncSocialInboxIsolated(
  env: Parameters<typeof syncXInboundMentions>[0]
    & Parameters<typeof syncXDirectMessages>[0]
    & Parameters<typeof syncInstagramDirectMessages>[0]
    & Parameters<typeof syncInstagramComments>[0],
  body: { userId?: string; monthlyLimitUsd?: number },
  adapters: InboxSyncAdapters = {},
) {
  const userId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : 'local-user';
  const mentions = adapters.syncXInboundMentions || syncXInboundMentions;
  const dm = adapters.syncXDirectMessages || syncXDirectMessages;
  const comments = adapters.syncInstagramComments || syncInstagramComments;
  const igDm = adapters.syncInstagramDirectMessages || syncInstagramDirectMessages;
  const [xMentions, xDm, instagramComments, instagramDm] = await Promise.allSettled([
    runIsolated(() => runWithSourceLease(env.DB, userId, 'x_mentions_sync', SOURCE_LEASE_TTL_MS, () => mentions(env, body))),
    runIsolated(() => runWithSourceLease(env.DB, userId, 'x_dm_sync', SOURCE_LEASE_TTL_MS, () => dm(env, body))),
    runIsolated(() => runWithSourceLease(env.DB, userId, 'instagram_comments_sync', SOURCE_LEASE_TTL_MS, () => comments(env, body))),
    runIsolated(() => runWithSourceLease(env.DB, userId, 'instagram_dm_sync', SOURCE_LEASE_TTL_MS, () => igDm(env, body))),
  ]);
  return {
    xMentions: wrap(fromSettled(xMentions)),
    xDm: wrap(fromSettled(xDm)),
    instagramComments: wrap(fromSettled(instagramComments)),
    instagramDm: wrap(fromSettled(instagramDm)),
  };
}

function fromSettled(result: PromiseSettledResult<SourceResult>): SourceResult {
  if (result.status === 'fulfilled') return result.value;
  return isolatedError(result.reason instanceof Error ? result.reason.message : 'Inbox source failed');
}

async function runIsolated(work: () => Promise<SourceResult>): Promise<SourceResult> {
  try {
    return await work();
  } catch (error) {
    return isolatedError(error instanceof Error ? error.message : 'Inbox source failed');
  }
}
