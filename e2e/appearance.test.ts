import { expect, test, type Page } from '@playwright/test';

const root = (page: Page, name: string) =>
	page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('an accent colour recolours the app at once, and is kept after a reload', async ({ page }) => {
	await page.goto('/settings/appearance');
	const colours = page.getByRole('radiogroup', { name: 'Accent colour' });
	await expect(colours).toHaveAccessibleDescription('Choose a colour that matches your style.');
	await expect(colours.getByRole('radio')).toHaveCount(6);
	await expect(colours.getByRole('radio', { name: 'Blue' })).toBeChecked();
	expect(await root(page, '--accent')).toBe('#1d4ed8');

	await colours.getByRole('radio', { name: 'Teal' }).check();
	expect(await root(page, '--accent')).toBe('#0f766e');
	await page.reload();
	await expect(colours.getByRole('radio', { name: 'Teal' })).toBeChecked();
	expect(await root(page, '--accent')).toBe('#0f766e');

	// Each colour has its own shade in dark.
	await page.getByRole('radio', { name: 'Dark', exact: true }).check();
	expect(await root(page, '--accent')).toBe('#2dd4bf');

	// And it's set before the app starts, on any page.
	await page.goto('/stores');
	expect(await page.evaluate(() => document.documentElement.dataset.accent)).toBe('teal');
});
