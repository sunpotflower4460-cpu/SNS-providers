import { expect, test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const workerPath = '/fixture-worker';
const scopes = ['tweet.read', 'users.read', 'follows.read', 'offline.access'];
let server: ViteDevServer;
let app: string;

test.beforeAll(async () => {
  server = await createServer({
    base: '/SNS-providers/',
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(workerPath) },
    server: { host: '127.0.0.1', port: 0, hmr: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Could not start the X setup fixture.');
  app = `http://127.0.0.1:${address.port}/SNS-providers/`;
});

test.afterAll(async () => {
  await server?.close();
});

test('X quick connect verifies consent, then reads profile, posts and mentions once', async ({ page }) => {
  const worker = new URL(workerPath, app).href;
  await page.addInitScript((appUrl) => {
    if (location.origin !== new URL(appUrl).origin) return;
    localStorage.setItem('sns-providers:onboarding-seen', '1');
    localStorage.setItem('sns-providers:sync-token', 'x-setup-fixture-token');
    if (!localStorage.getItem('sns-providers:v1')) {
      localStorage.setItem('sns-providers:v1', JSON.stringify({ relationshipPolicy: { autoReplenishEnabled: false } }));
    }
  }, app);

  let connectedAt: string | null = null;
  const xPosts: Array<{ path: string; body: unknown }> = [];
  const consentUrl = new URL('https://x.com/i/oauth2/authorize');
  consentUrl.searchParams.set('scope', scopes.join(' '));
  await page.route((url) => url.origin === consentUrl.origin && url.pathname === consentUrl.pathname, (route) => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><meta charset="utf-8"><a href="/fixture-consent">アプリにアクセスを許可</a>',
  }));
  await page.route('https://x.com/fixture-consent', (route) => {
    connectedAt = new Date().toISOString();
    return route.fulfill({ status: 302, headers: { location: `${app}?x_oauth=connected` } });
  });
  await page.route(`${worker}/**`, (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice(workerPath.length);
    if (request.method() === 'POST' && path.startsWith('/api/x/')) {
      xPosts.push({ path, body: request.postDataJSON() });
    }
    const now = new Date().toISOString();
    const replies: Record<string, unknown> = {
      '/api/health': { ok: true },
      '/api/preflight': {
        ai: { groq: true, groqFree: true, discovery: true },
        x: { configured: true, tokenValid: Boolean(connectedAt) },
        inboxSources: { xMentions: { status: connectedAt ? 'READY' : 'BLOCKED' } },
      },
      '/api/x/oauth/start': { authorizeUrl: consentUrl.href },
      '/api/x/oauth/status': {
        configured: true, connected: Boolean(connectedAt), scopes,
        expiresAt: null, updatedAt: connectedAt, xUserId: connectedAt ? '1234' : null,
      },
      '/api/x/owned/sync': {
        enabled: true, source: 'x', costUsd: 0.011, startedAt: now, syncedAt: now,
        profile: {
          id: '1234', username: 'fixture_owner', name: 'Fixture owner', description: '自分のプロフィール',
          verified: false, profileImageUrl: null, publicMetrics: { followers: 1, following: 2, posts: 3 },
        },
        followers: [], following: [],
        posts: [{
          id: '4567', text: '最近の投稿の内容', createdAt: now,
          publicMetrics: { likes: 0, replies: 0, reposts: 0, quotes: 0 },
        }],
        requested: { followers: 0, following: 0, posts: 5 },
        coverage: {
          followers: { fetched: 0, complete: false }, following: { fetched: 0, complete: false },
          posts: { fetched: 1, complete: true },
        },
        resumePaging: { followersCursor: null, followingCursor: null, followersCycle: 0, followingCycle: 0 },
        pacing: { daysRemaining: 10, pacedCapUsd: 0.2, globalRemainingUsd: 3 },
      },
      '/api/x/inbound/sync': {
        enabled: true, source: 'x', costUsd: 0.005, syncedAt: now, events: [{
          id: 'mention-9876', actionId: 'sa-x-mention-9876', type: 'mention', externalEventId: '9876',
          externalUserId: '5678', username: 'music_listener', text: '新しいメンション', occurredAt: now,
        }],
      },
      '/api/budget': { usedUsd: 0.016, limitUsd: 3, remainingUsd: 2.984, ledgerAvailable: true },
      '/api/social/actions': { ok: true, actions: [] },
      '/api/social/inbox/sync': {},
    };
    const json = replies[path];
    return route.fulfill({ status: json ? 200 : 404, json: json || {} });
  });

  await page.goto(`${app}?x_oauth=connected`);
  const quickConnect = page.getByRole('region', { name: 'Xの読み取り連携' });
  const button = quickConnect.getByRole('button', { name: 'Xをつなぐ' });
  await expect(button).toBeVisible();
  expect(xPosts).toHaveLength(0);

  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Xをつなぐ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '今日', exact: true }).click();
  await button.click();
  await expect.poll(() => xPosts).toEqual([{ path: '/api/x/oauth/start', body: { intent: 'read' } }]);
  await expect(page).toHaveURL(consentUrl.href);
  const consent = page.getByRole('link', { name: 'アプリにアクセスを許可' });
  await expect(consent).toBeVisible();
  await consent.click();
  await expect.poll(() => connectedAt).not.toBeNull();
  await expect(quickConnect).toContainText('プロフィールを取得。最近の投稿 1件');
  await expect(quickConnect).toContainText('メンション 1件を確認');
  await expect(page.getByText('新しいメンション', { exact: false }).first()).toBeVisible();
  expect(xPosts.find(({ path }) => path === '/api/x/owned/sync')?.body).toMatchObject({
    maxFollowers: 0, maxFollowing: 0, maxPosts: 5, monthlyLimitUsd: 3, profileAndPostsOnly: true,
  });

  const ordinaryRefresh = page.waitForResponse(`${worker}/api/social/inbox/sync`);
  await page.reload();
  await ordinaryRefresh;
  await expect(page.getByText('新しいメンション', { exact: false }).first()).toBeVisible();
  expect(xPosts.map(({ path }) => path).sort()).toEqual([
    '/api/x/inbound/sync', '/api/x/oauth/start', '/api/x/owned/sync',
  ]);
});
