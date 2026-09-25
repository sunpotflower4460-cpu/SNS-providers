import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('local iPhone flow records only confirmed actions and restores a JSON backup', async ({ page, browser }) => {
  await page.addInitScript(() => {
    window.open = ((url?: string | URL) => {
      sessionStorage.setItem('last-official-url', String(url || ''));
      return null;
    }) as typeof window.open;
  });
  await page.goto('/SNS-providers/');
  await page.getByRole('button', { name: 'スキップ' }).click();
  await expect(page.getByText('AIからのヒント')).toHaveCount(0);

  await page.getByRole('button', { name: '候補を探す' }).click();
  await expect(page.getByRole('heading', { name: '自分で候補を追加' })).toBeVisible();
  await expect(page.getByRole('button', { name: /新しい候補を探す/ })).toHaveCount(0);
  const reference = page.getByRole('textbox', { name: 'プロフィールURL または @username' });
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.locator('.manual-import-note')).toContainText('入力してください');
  await reference.fill('https://example.com/not-a-profile');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(reference).toHaveValue('https://example.com/not-a-profile');
  await expect(page.locator('.manual-import-note')).toContainText('正しい@username');

  await reference.fill('@daily_quality_test');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText('1人')).toBeVisible();
  await page.getByRole('button', { name: '今日', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登録した候補を確認しましょう' })).toBeVisible();
  await page.getByRole('button', { name: '候補を確認する' }).click();

  await page.getByRole('button', { name: /Instagramでプロフィールを確認/ }).click();
  await expect(page.getByRole('dialog', { name: /daily_quality_test/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('last-official-url')))
    .toBe('https://www.instagram.com/daily_quality_test/');
  await page.reload();
  await expect(page.getByRole('dialog', { name: /daily_quality_test/ })).toBeVisible();
  await page.getByRole('button', { name: 'プロフィールを確認した' }).click();
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '今日', exact: true }).click();
  await expect(page.getByRole('heading', { name: '候補のプロフィールを確認しました' })).toBeVisible();
  await page.getByRole('button', { name: '関係', exact: true }).click();
  await expect(page.getByText('0', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: '探す', exact: true }).click();
  await page.getByRole('button', { name: /Instagramでプロフィールを確認/ }).click();
  await page.getByRole('button', { name: 'フォローした' }).click();
  await page.getByRole('button', { name: '関係', exact: true }).click();
  await expect(page.getByText('@daily_quality_test')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '関係', exact: true }).click();
  await expect(page.getByText('@daily_quality_test')).toBeVisible();

  await page.getByRole('button', { name: '設定', exact: true }).click();
  await page.getByText('バックアップ', { exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'バックアップを書き出す' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).toBeTruthy();
  const backup = await readFile(path!);
  const envelope = JSON.parse(backup.toString('utf8'));
  expect(envelope.format).toBe('social-mission-backup');
  expect(envelope.state.candidates).toHaveLength(1);
  expect(envelope.state.interactions.some((item: { action: string }) => item.action === 'followed')).toBe(true);

  const restoredContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const restored = await restoredContext.newPage();
  await restored.goto('/SNS-providers/');
  await restored.getByRole('button', { name: 'スキップ' }).click();
  await restored.getByRole('button', { name: '設定', exact: true }).click();
  await restored.getByText('バックアップ', { exact: true }).click();
  await restored.locator('input[type="file"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backup });
  await expect(restored.getByText('現在のデータを置き換えます')).toBeVisible();
  await restored.getByRole('button', { name: 'この内容で復元' }).click();
  await expect(restored.getByText('候補・履歴・設定を確認してください。')).toBeVisible();
  await restored.getByRole('button', { name: '関係', exact: true }).click();
  await expect(restored.getByText('@daily_quality_test')).toBeVisible();
  await restoredContext.close();
});

test('local save failure is shown in a readable alert', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'sns-providers:v1') throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/SNS-providers/');
  await expect(page.getByRole('alert')).toContainText('ローカル保存容量がいっぱいです');
});

test('a deferred handoff does not reopen after the user dismisses the result sheet', async ({ page }) => {
  await page.addInitScript(() => { window.open = (() => null) as typeof window.open; });
  await page.goto('/SNS-providers/');
  await page.getByRole('button', { name: 'スキップ' }).click();
  await page.getByRole('button', { name: '候補を探す' }).click();
  await page.getByRole('textbox', { name: 'プロフィールURL または @username' }).fill('@deferred_quality_test');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.getByRole('button', { name: /Instagramでプロフィールを確認/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a changed profile identity does not restore an old result sheet', async ({ page }) => {
  await page.addInitScript(() => { window.open = (() => null) as typeof window.open; });
  await page.goto('/SNS-providers/');
  await page.getByRole('button', { name: 'スキップ' }).click();
  await page.getByRole('button', { name: '候補を探す' }).click();
  await page.getByRole('textbox', { name: 'プロフィールURL または @username' }).fill('@original_quality_test');
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.getByRole('button', { name: /Instagramでプロフィールを確認/ }).click();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('sns-providers:v1') || '{}');
    state.candidates[0].username = 'different_quality_test';
    localStorage.setItem('sns-providers:v1', JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('installed shell opens without a network connection after first load', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit fails internally on offline reload; verify this on a physical iPhone.');
  await page.goto('/SNS-providers/');
  await page.getByRole('button', { name: 'スキップ' }).click();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'まず、つながる候補を見つけましょう' })).toBeVisible();
});

test('old example insights are removed from existing local state', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sns-providers:v1', JSON.stringify({
      insights: [{ id: 'i1', category: 'profile', priority: 'high', title: '初見の人への入口を強くする', body: '旧版の例示テキスト' }],
      candidates: [],
    }));
  });
  await page.goto('/SNS-providers/');
  await page.getByRole('button', { name: 'スキップ' }).click();
  await expect(page.getByText('AIからのヒント')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'まず、つながる候補を見つけましょう' })).toBeVisible();
});

test('identity-conflicted profiles cannot be recorded as a new follow', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sns-providers:v1', JSON.stringify({
      candidates: [{
        id: 'instagram-conflict', platform: 'instagram', username: 'identity_review',
        displayName: 'identity_review', bio: '', profileUrl: 'https://www.instagram.com/identity_review/',
        kind: 'other', match: 50, relationshipScore: 0, stage: 'discovered',
        reason: '本人確認が必要です。', tags: ['identity-conflict'], recommendedAction: 'review',
      }],
      interactions: [], insights: [],
    }));
    window.open = (() => null) as typeof window.open;
  });
  await page.goto('/SNS-providers/');
  await page.getByRole('button', { name: 'スキップ' }).click();
  await page.getByRole('button', { name: '探す', exact: true }).click();
  await page.getByRole('button', { name: /Instagramでプロフィールを確認/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'フォローした' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'プロフィールを確認した' })).toBeVisible();
});
