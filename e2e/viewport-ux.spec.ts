import { expect, test, Page } from '@playwright/test';

async function openWorkspace(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hachihi_quick_tour_done_v1', '1');
      localStorage.setItem('hachihi_last_seen_version', '3.1.1');
    } catch {
      // ignore
    }
  });
  await page.goto('/');
  const closeHub = page.getByRole('button', { name: 'Đóng quản lý dự án' });
  try {
    await closeHub.waitFor({ state: 'visible', timeout: 8000 });
    await closeHub.click();
  } catch {
    // already dismissed
  }
}

test.describe('Viewport UX: 2D/3D, zoom và xuất', () => {
  test('chỉ có một nút chuyển 2D/3D trên màn hình desktop', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'Desktop only');
    await openWorkspace(page);
    await expect(page.getByTestId('toggle-3d-btn')).toHaveCount(1);
    await page.getByTestId('toggle-3d-btn').click();
    await expect(page.getByTestId('toggle-3d-btn')).toHaveCount(1);
    await expect(page.getByTestId('toggle-3d-label-3d')).toHaveClass(/opacity-100/);
  });

  test('chuyển 2D → 3D → 2D giữ nguyên dữ liệu và nút 2D-only bị mờ ở 3D', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'Desktop only');
    await openWorkspace(page);
    const toggle = page.getByTestId('toggle-3d-btn');
    await toggle.click();
    await expect(page.getByTestId('3d-xyz-gizmo')).toBeVisible();
    // Lưới 2D không khả dụng trong 3D
    await expect(page.getByRole('button', { name: /Lưới/ }).first()).toBeDisabled();
    await toggle.click();
    await expect(page.getByTestId('canvas-top-ruler')).toBeVisible();
  });

  test('Ctrl + cuộn thay đổi zoom 2D và có thể về 100%', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'Desktop only');
    await openWorkspace(page);
    const ruler = page.getByTestId('canvas-top-ruler');
    await expect(ruler).toBeVisible();
    const box = await ruler.boundingBox();
    const x = (box?.x ?? 400) + 200;
    const y = (box?.y ?? 100) + 200;
    await page.mouse.move(x, y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await expect(page.getByRole('button', { name: 'Thu nhỏ' })).toBeVisible();
  });

  test('hộp thoại xuất: chọn 3D làm mờ SVG/DXF', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 1440) < 768, 'Desktop only');
    await openWorkspace(page);
    await page.getByTestId('toggle-3d-btn').click();
    await page.getByRole('button', { name: /Xuất/ }).first().click();
    const dialog = page.getByRole('dialog').first();
    await expect(dialog.getByTestId('export-scope-3d')).toHaveAttribute('aria-pressed', 'true');
  });
});
