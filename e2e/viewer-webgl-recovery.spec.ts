import { expect, test } from '@playwright/test';
import { armProbe, buildViewerFixtures, fixtureUrl, viewerState, waitViewerReady, webglLaunchOptions } from './helpers/viewerFixture';

test.use({ launchOptions: webglLaunchOptions });
test.beforeAll(() => buildViewerFixtures());

test('mất WebGL context: báo rõ, dừng render, chặn thao tác; khôi phục: dựng lại và vẽ tiếp', async ({ page, context }) => {
  const probe = await armProbe(context, page);
  await page.goto(fixtureUrl('viewer-preview.html'));
  await waitViewerReady(page);

  await page.evaluate(() => {
    const c = document.querySelector('#v3d-stage canvas') as HTMLCanvasElement;
    const ext = (c.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!;
    (window as any).__loseExt = ext;
    ext.loseContext();
  });
  await expect(page.locator('#v3d-ctxlost')).toBeVisible();
  await expect(page.locator('#v3d-ctxlost')).toContainText('WebGL');
  await page.waitForTimeout(300);
  const lost = await viewerState(page);
  expect(lost.contextLost).toBe(true);
  expect(lost.pendingRaf).toBe(0);
  const framesWhileLost = lost.frames;

  // Thao tác khi đang mất context không được làm gì (không vẽ, không mở thông tin).
  await page.click('#v3d-reset', { force: true });
  await page.waitForTimeout(500);
  expect((await viewerState(page)).frames).toBe(framesWhileLost);
  await expect(page.locator('#v3d-info')).toBeHidden();

  await page.evaluate(() => (window as any).__loseExt.restoreContext());
  await expect(page.locator('#v3d-ctxlost')).toBeHidden();
  await expect.poll(async () => (await viewerState(page)).contextLost).toBe(false);
  await page.click('[data-preset="top"]');
  await expect.poll(async () => (await viewerState(page)).frames, { timeout: 5000 }).toBeGreaterThan(framesWhileLost);
  expect(probe.errors).toEqual([]);
});

test('nút "Tải lại trang" tồn tại trong lớp phủ mất context', async ({ page, context }) => {
  await armProbe(context, page);
  await page.goto(fixtureUrl('viewer-preview.html'));
  await waitViewerReady(page);
  await expect(page.locator('#v3d-reload')).toHaveCount(1);
});
