import { expect, test } from '@playwright/test';
import path from 'node:path';

test('admin can publish, copy, download and withdraw a TubeLite APK', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Tên đăng nhập').fill('e2e-admin');
  await page.getByLabel('Mật khẩu').fill('E2e-Only-Password-123!');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await expect(page.getByRole('heading', { name: 'Ứng dụng của bạn' })).toBeVisible();

  await page.getByRole('button', { name: 'Tạo ứng dụng', exact: true }).click();
  await page.getByLabel('Tên ứng dụng').fill('TubeLite E2E');
  await page.getByLabel('Package name').fill('com.tubelite');
  await page.getByRole('button', { name: 'Lưu ứng dụng' }).click();
  await expect(page.getByRole('button', { name: /TubeLite E2E/ })).toBeVisible();

  await page.getByLabel('File APK').setInputFiles(path.resolve(process.cwd(), '../backend/tests/fixtures/generated/tubelite-debug.apk'));
  await page.getByLabel('Ghi chú phát hành').fill('Kiểm thử phát hành trên Playwright');
  await page.getByRole('button', { name: 'Phát hành APK' }).click();
  await expect(page.getByText(/Đã phát hành version 3/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('link', { name: 'Mở link APK' })).toBeVisible();
  await expect(page.locator('tbody tr').filter({ hasText: 'Version 3 · 2.1.0' })).toBeVisible();
  await page.screenshot({ path: path.resolve(process.cwd(), 'test-results/admin-console.png'), fullPage: true });

  const downloadUrl = await page.getByRole('link', { name: 'Mở link APK' }).getAttribute('href');
  expect(downloadUrl).toBeTruthy();
  await page.getByRole('button', { name: 'Sao chép link' }).click();
  await expect(page.getByRole('status')).toContainText('Đã sao chép link APK.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(downloadUrl);

  const download = await page.request.get(downloadUrl!);
  expect(download.status()).toBe(200);
  expect(Number(download.headers()['content-length'])).toBeGreaterThan(1_000_000);
  expect((await download.body()).subarray(0, 2).toString()).toBe('PK');

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Thu hồi' }).click();
  await expect(page.locator('tbody tr .release-status.withdrawn')).toHaveText('Đã thu hồi');
  expect((await page.request.get(downloadUrl!)).status()).toBe(404);
});
