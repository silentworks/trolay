import { expect, test } from '@playwright/test';
import { menu } from './shared';

// A phone set to dark mode.
test.use({ colorScheme: 'dark' });

const theme = (page: import('@playwright/test').Page) =>
	page.evaluate(() => document.documentElement.dataset.theme);

test('opens in light mode, and keeps the look chosen in Settings', async ({ page }) => {
	await page.goto('/');
	expect(await theme(page)).toBe('light');

	await menu(page, 'Settings');
	await page.getByRole('link', { name: /^Appearance/ }).click();
	await expect(page.getByRole('radio', { name: 'Light', exact: true })).toBeChecked();
	await page.getByRole('radio', { name: 'Dark', exact: true }).check();
	expect(await theme(page)).toBe('dark');
	await page.reload();
	expect(await theme(page)).toBe('dark');

	// Matching the phone follows it as it switches.
	await page.getByRole('radio', { name: /^Match my phone/ }).check();
	expect(await theme(page)).toBe('dark');
	await page.emulateMedia({ colorScheme: 'light' });
	await expect.poll(() => theme(page)).toBe('light');
	await page.reload();
	expect(await theme(page)).toBe('light');

	await page.getByRole('radio', { name: 'Light', exact: true }).check();
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.reload();
	expect(await theme(page)).toBe('light');
	await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f6f8fc');
});
