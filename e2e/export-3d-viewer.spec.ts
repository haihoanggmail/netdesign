import { expect, test } from '@playwright/test';
import { armProbe, buildViewerFixtures, fixtureUrl, viewerState, waitViewerReady, webglLaunchOptions } from './helpers/viewerFixture';
import { readFileSync } from 'node:fs';

test.use({ launchOptions: webglLaunchOptions });
test.beforeAll(() => buildViewerFixtures());

test.describe('HTML 3D đã xuất — chạy trong Chromium mới, mất mạng', () => {
  test('dựng cảnh offline: không lỗi JS, không request ngoài, không phụ thuộc phiên ứng dụng', async ({ page, context }) => {
    const probe = await armProbe(context, page);
    await page.goto(fixtureUrl('viewer-full.html'));
    await waitViewerReady(page);
    expect(await page.locator('#v3d-stage canvas').count()).toBe(1);
    expect(probe.blockedRequests, 'không được có request ra ngoài').toEqual([]);
    expect(probe.errors).toEqual([]);
    // Bố cục không tràn ngang ở mọi cỡ viewport của project (desktop / tablet / mobile).
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator('.v3d-bar')).toBeVisible();
  });

  test('RAF: đứng yên thì dừng hẳn; luôn ≤ 1 RAF chờ', async ({ page, context }) => {
    await armProbe(context, page);
    await page.goto(fixtureUrl('viewer-preview.html'));
    await waitViewerReady(page);
    await page.waitForTimeout(1500); // đợi damping/khởi tạo xong
    const a = await viewerState(page);
    await page.waitForTimeout(600);
    const b = await viewerState(page);
    expect(a.pendingRaf).toBe(0);
    expect(b.pendingRaf).toBe(0);
    expect(b.frames).toBe(a.frames); // không vẽ vô ích khi đứng yên
  });

  test('xoay / zoom / pan / góc nhìn / auto-rotate', async ({ page, context }) => {
    const probe = await armProbe(context, page);
    await page.goto(fixtureUrl('viewer-preview.html'));
    await waitViewerReady(page);
    const box = (await page.locator('#v3d-stage canvas').boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const f0 = (await viewerState(page)).frames;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 40, { steps: 8 });
    await page.mouse.up();
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(500);
    expect((await viewerState(page)).frames).toBeGreaterThan(f0);
    for (const p of ['top', 'front', 'side', 'iso']) {
      const f = (await viewerState(page)).frames;
      await page.click(`[data-preset="${p}"]`);
      await page.waitForTimeout(800);
      expect((await viewerState(page)).frames, p).toBeGreaterThan(f);
    }
    await page.click('#v3d-auto');
    const fa = (await viewerState(page)).frames;
    await page.waitForTimeout(600);
    expect((await viewerState(page)).frames).toBeGreaterThan(fa);
    await page.click('#v3d-auto');
    await page.waitForTimeout(800);
    const s1 = await viewerState(page);
    await page.waitForTimeout(500);
    const s2 = await viewerState(page);
    expect(s2.frames).toBe(s1.frames);
    expect(s2.pendingRaf).toBe(0);
    expect(probe.errors).toEqual([]);
  });

  test('bật/tắt cáp & nhãn; chọn thiết bị; thông tin khớp chế độ preview', async ({ page, context }) => {
    await armProbe(context, page);
    await page.goto(fixtureUrl('viewer-preview.html'));
    await waitViewerReady(page);
    expect((await viewerState(page)).cablesVisible).toBe(true);
    await page.click('#v3d-cables');
    expect((await viewerState(page)).cablesVisible).toBe(false);
    await page.click('#v3d-cables');
    expect((await viewerState(page)).cablesVisible).toBe(true);
    await page.click('#v3d-labels');
    expect((await viewerState(page)).labelsVisible).toBe(false);
    await page.click('#v3d-labels');
    expect((await viewerState(page)).labelsVisible).toBe(true);

    await page.click('#v3d-reset');
    await page.waitForTimeout(900);
    const box = (await page.locator('#v3d-stage canvas').boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // thiết bị SW-01 nằm tại tâm khung nhìn
    await expect(page.locator('#v3d-info')).toBeVisible();
    await expect(page.locator('#v3d-info')).toContainText('SW-01');
    await expect(page.locator('#v3d-info')).not.toContainText('10.99.88.77'); // preview: không có IP
  });

  test('theme đổi cả nền cảnh 3D (không chỉ CSS bảng điều khiển)', async ({ page, context }) => {
    await armProbe(context, page);
    await page.goto(fixtureUrl('viewer-preview.html'));
    await waitViewerReady(page);
    const light = (await viewerState(page)).background;
    await page.click('#v3d-theme');
    await expect(page.locator('body')).toHaveClass(/dark/);
    const dark = (await viewerState(page)).background;
    expect(dark).not.toBe(light);
    await page.click('#v3d-theme');
    expect((await viewerState(page)).background).toBe(light);
  });

  test('xuất PNG tạo file ảnh thật', async ({ page, context }) => {
    await armProbe(context, page);
    await page.goto(fixtureUrl('viewer-preview.html'));
    await waitViewerReady(page);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#v3d-shot')]);
    expect(dl.suggestedFilename()).toBe('hachihi-3d-view.png');
    const path = await dl.path();
    const buf = readFileSync(path!);
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // chữ ký PNG
    expect(buf.length).toBeGreaterThan(2000);
  });

  test('tên thiết bị chứa HTML/script không được thực thi', async ({ page, context }) => {
    const probe = await armProbe(context, page);
    await page.goto(fixtureUrl('viewer-full.html'));
    await waitViewerReady(page);
    await page.click('#tabdev');
    expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    await expect(page.locator('#viewdev')).toContainText('<img src=x onerror=window.__xss=1>');
    expect(probe.errors).toEqual([]);
  });
});
