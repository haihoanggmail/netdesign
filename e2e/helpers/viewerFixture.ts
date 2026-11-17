import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';

export const FIXTURE_DIR = resolve('test-results/viewer-fixture');

/** Sinh HTML 3D thật (một lần cho mỗi file spec). */
export function buildViewerFixtures(): void {
  execFileSync('npx', ['tsx', 'e2e/helpers/make-viewer-fixture.ts', FIXTURE_DIR], { stdio: 'inherit', shell: process.platform === 'win32' });
}

export const fixtureUrl = (name: 'viewer-preview.html' | 'viewer-full.html') => `file://${resolve(FIXTURE_DIR, name)}`;

/** Cờ Chromium để WebGL 2 chạy được trong môi trường headless/CI (SwiftShader). */
export const webglLaunchOptions = {
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}),
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
};

export interface ViewerProbe {
  errors: string[];
  blockedRequests: string[];
}

/**
 * Chặn mọi request ngoài file:/data:/blob: (mô phỏng mất mạng) và gom lỗi JS/console.
 * Phải gọi TRƯỚC page.goto.
 */
export async function armProbe(context: BrowserContext, page: Page): Promise<ViewerProbe> {
  const probe: ViewerProbe = { errors: [], blockedRequests: [] };
  await context.setOffline(true);
  await context.route('**/*', route => {
    const u = route.request().url();
    if (/^(file|data|blob):/i.test(u)) return route.continue();
    probe.blockedRequests.push(u);
    return route.abort();
  });
  page.on('pageerror', e => probe.errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/GL Driver Message|swiftshader|GPU stall|ReadPixels/i.test(t)) return; // nhiễu driver, không phải lỗi ứng dụng
    probe.errors.push(`console.error: ${t}`);
  });
  return probe;
}

export async function waitViewerReady(page: Page): Promise<void> {
  await expect(page.locator('#v3d-fatal')).toBeHidden();
  await expect(page.locator('#v3d-loading')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('#v3d-stage canvas')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).__hachihiViewer3D) && (window as any).__hachihiViewer3D.frames > 0);
}

export const viewerState = (page: Page) =>
  page.evaluate(() => {
    const v = (window as any).__hachihiViewer3D;
    return {
      pendingRaf: v.pendingRaf as number, frames: v.frames as number, contextLost: v.contextLost as boolean,
      background: v.background as number, cablesVisible: v.cablesVisible as boolean, labelsVisible: v.labelsVisible as boolean
    };
  });
