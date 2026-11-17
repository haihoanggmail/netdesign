import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { armProbe, buildViewerFixtures, FIXTURE_DIR, fixtureUrl, waitViewerReady, webglLaunchOptions } from './helpers/viewerFixture';

test.use({ launchOptions: webglLaunchOptions });
test.beforeAll(() => buildViewerFixtures());

const SECRETS = ['10.99.88.77', '4090', 'AST-SECRET-1', 'VendorSecret', 'ModelSecret', 'CableTypeSecret'];

test('chế độ chỉ xem: toàn bộ file không chứa dữ liệu nhạy cảm; đối tượng ẩn không bị nhúng', () => {
  const html = readFileSync(resolve(FIXTURE_DIR, 'viewer-preview.html'), 'utf8');
  for (const s of SECRETS) expect(html.includes(s), s).toBe(false);
  expect(html.includes('AN-HIEN')).toBe(false);
  expect(html.includes('C-AN')).toBe(false);
});

test('bật đầy đủ: bảng thiết bị khớp header và cảnh (4 thiết bị, 2 cáp), node thiếu asset vẫn có dòng', async ({ page, context }) => {
  await armProbe(context, page);
  await page.goto(fixtureUrl('viewer-full.html'));
  await waitViewerReady(page);
  await expect(page.locator('header .meta').last()).toContainText('4 thiết bị · 1 tủ Rack · 2 tuyến cáp');
  await page.click('#tabdev');
  await expect(page.locator('#viewdev tbody tr')).toHaveCount(4);
  const ap = page.locator('#viewdev tbody tr', { hasText: 'AP-01' });
  await expect(ap).toHaveCount(1);
  await expect(ap).toContainText('—');
  await page.click('#tabcab');
  await expect(page.locator('#viewcab tbody tr')).toHaveCount(2);
  await expect(page.locator('#viewcab')).not.toContainText('C-AN');
});
