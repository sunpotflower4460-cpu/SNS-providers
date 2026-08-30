import { syncInstagramComments } from './instagram/commentSync';
import { syncInstagramDirectMessages } from './instagram/dmSync';
import { syncXDirectMessages } from './x/dmSync';
import { syncXInboundMentions } from './x/sync';

type SourceResult = Record<string, unknown> & { status?: string; enabled?: boolean; reason?: string };

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
  const mentions = adapters.syncXInboundMentions || syncXInboundMentions;
  const dm = adapters.syncXDirectMessages || syncXDirectMessages;
  const comments = adapters.syncInstagramComments || syncInstagramComments;
  const igDm = adapters.syncInstagramDirectMessages || syncInstagramDirectMessages;
  const xMentions = await runIsolated(() => mentions(env, body));
  const xDm = await runIsolated(() => dm(env, body));
  const instagramComments = await runIsolated(() => comments(env, body));
  const instagramDm = await runIsolated(() => igDm(env, body));
  return {
    xMentions: wrap(xMentions),
    xDm: wrap(xDm),
    instagramComments: wrap(instagramComments),
    instagramDm: wrap(instagramDm),
  };
}

async function runIsolated(work: () => Promise<SourceResult>): Promise<SourceResult> {
  try {
    return await work();
  } catch (error) {
    return isolatedError(error instanceof Error ? error.message : 'Inbox source failed');
  }
}
