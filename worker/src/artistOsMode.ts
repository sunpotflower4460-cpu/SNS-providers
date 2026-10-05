// Artist OS runtime mode.
//
// standalone (default): SNS-providers behaves exactly as it always has.
// artist_os_managed: My-SNS is the canonical inbound owner for Instagram comment/DM events and the
// canonical Meta webhook receiver. SNS-providers keeps relationship intelligence + proactive
// engagement, but never ingests those events and never sends an external reply for them.
// Any unrecognised non-empty value fails closed to managed with modeInvalid=true.

export type ArtistOsRuntimeMode = 'standalone' | 'artist_os_managed';

export interface ArtistOsModeEnv {
  ARTIST_OS_MODE?: string;
}

export interface ResolvedArtistOsMode {
  runtimeMode: ArtistOsRuntimeMode;
  managed: boolean;
  modeInvalid: boolean;
}

export const MANAGED_INBOUND_OWNER_CODE = 'MANAGED_MODE_INBOUND_OWNER_MY_SNS';
export const MANAGED_NOT_CANONICAL_META_RECEIVER_CODE = 'MANAGED_MODE_NOT_CANONICAL_META_RECEIVER';

export function resolveArtistOsMode(env: ArtistOsModeEnv | null | undefined): ResolvedArtistOsMode {
  const raw = typeof env?.ARTIST_OS_MODE === 'string' ? env.ARTIST_OS_MODE.trim() : '';
  if (raw === '' || raw === 'standalone') return { runtimeMode: 'standalone', managed: false, modeInvalid: false };
  if (raw === 'artist_os_managed') return { runtimeMode: 'artist_os_managed', managed: true, modeInvalid: false };
  return { runtimeMode: 'artist_os_managed', managed: true, modeInvalid: true };
}

export function isManagedMode(env: ArtistOsModeEnv | null | undefined) {
  return resolveArtistOsMode(env).managed;
}

/** Instagram comment reply / DM reply action ids (My-SNS owns these inbound events in managed mode). */
export function isInstagramInboundReplyActionId(actionId: string) {
  return /^sa-ig-(?:comment|dm)-/.test(actionId.trim());
}

export function managedInboundOwnerBody(extra: Record<string, unknown> = {}) {
  return {
    ok: false as const,
    executionMode: 'handoff' as const,
    ownerSystem: 'my-sns' as const,
    code: MANAGED_INBOUND_OWNER_CODE,
    message: 'Artist OS managed mode: My-SNS owns Instagram inbound comment/DM replies. SNS-providers does not send them; hand off to My-SNS.',
    ...extra,
  };
}

export interface ReplyOwnership {
  inboundReplyExecution: { instagram: boolean; x: boolean };
  canonicalMetaWebhookReceiver: boolean;
  relationshipIntelligence: true;
  proactiveEngagement: true;
}

export interface OwnershipEnv extends ArtistOsModeEnv {
  SOCIAL_WRITE_ENABLED?: string;
  SOCIAL_WRITE_MODE?: string;
  INSTAGRAM_COMMENT_REPLY_ENABLED?: string;
  INSTAGRAM_DM_WRITE_ENABLED?: string;
  X_REPLY_WRITE_ENABLED?: string;
}

// Derivation (documented in docs/artist-os-managed-mode.md):
//  - managed: instagram=false, canonicalMetaWebhookReceiver=false; x follows the write flags.
//  - standalone: instagram=true only if the comment-reply or DM write flag makes it executable
//    (SOCIAL_WRITE_ENABLED=true plus the per-operation flag, or SOCIAL_WRITE_MODE=test); x likewise
//    for X_REPLY_WRITE_ENABLED. canonicalMetaWebhookReceiver=true (this Worker receives Meta webhooks).
export function resolveOwnership(env: OwnershipEnv): ReplyOwnership {
  const mode = resolveArtistOsMode(env);
  const test = env.SOCIAL_WRITE_MODE === 'test';
  const master = env.SOCIAL_WRITE_ENABLED === 'true';
  const igWritable = test || (master && (env.INSTAGRAM_COMMENT_REPLY_ENABLED === 'true' || env.INSTAGRAM_DM_WRITE_ENABLED === 'true'));
  const xWritable = test || (master && env.X_REPLY_WRITE_ENABLED === 'true');
  return {
    inboundReplyExecution: { instagram: !mode.managed && igWritable, x: xWritable },
    canonicalMetaWebhookReceiver: !mode.managed,
    relationshipIntelligence: true,
    proactiveEngagement: true,
  };
}

export function artistOsCapabilityStrings(env: OwnershipEnv): string[] {
  const own = resolveOwnership(env);
  const caps = ['relationship.intelligence', 'engagement.proactive', 'reply.prepare'];
  if (own.inboundReplyExecution.instagram) {
    if (env.SOCIAL_WRITE_MODE === 'test' || (env.SOCIAL_WRITE_ENABLED === 'true' && env.INSTAGRAM_COMMENT_REPLY_ENABLED === 'true')) caps.push('reply.instagram.comment.execute');
    if (env.SOCIAL_WRITE_MODE === 'test' || (env.SOCIAL_WRITE_ENABLED === 'true' && env.INSTAGRAM_DM_WRITE_ENABLED === 'true')) caps.push('reply.instagram.dm.execute');
  }
  if (own.inboundReplyExecution.x) caps.push('reply.x.mention.execute');
  return caps;
}

export function artistOsModeReport(env: OwnershipEnv) {
  const mode = resolveArtistOsMode(env);
  return {
    runtimeMode: mode.runtimeMode,
    modeInvalid: mode.modeInvalid,
    ownership: resolveOwnership(env),
    capabilities: artistOsCapabilityStrings(env),
  };
}
