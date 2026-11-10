import { expect, test, type Page } from '@playwright/test';
import { CHANGELOG, SECTIONS } from '../src/lib/changelog.ts';
import { BASE } from './global-setup';

const sheet = (page: Page) => page.getByRole('dialog', { name: "What's new" });
const seen = (page: Page, version: string | null) =>
	page.evaluate((value) => {
		if (value === null) localStorage.removeItem('trolley.whatsNewSeen');
		else localStorage.setItem('trolley.whatsNewSeen', value);
	}, version);

test('after an update, what changed since last time shows once, skipped releases included', async ({
	page
}) => {
	await page.goto('/');
	await expect(sheet(page)).toBeHidden();
	// This phone last saw the third entry: the two after it are new to it.
	await seen(page, CHANGELOG[2].version);
	await page.reload();

	const news = sheet(page);
	await expect(news).toBeVisible();
	await expect(news.getByRole('heading', { level: 3 })).toHaveCount(2);
	await expect(news.getByRole('heading', { level: 3 }).first()).toContainText(CHANGELOG[0].version);
	await expect(news).not.toContainText(CHANGELOG[2].version);
	// The newest release's first section, whichever it is.
	const section = SECTIONS.find(({ key }) => CHANGELOG[0][key]?.length)!.title;
	await expect(news.getByRole('heading', { name: section, level: 4 }).first()).toBeVisible();

	await news.getByRole('button', { name: 'Got it' }).click();
	await expect(news).toBeHidden();
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
	await expect(sheet(page)).toBeHidden();
});

test.describe('a phone in use before this was kept', () => {
	test.use({
		storageState: {
			cookies: [],
			origins: [
				{
					origin: BASE,
					localStorage: [{ name: 'trolley.onboarded', value: 'true' }]
				}
			]
		}
	});

	test('sees the newest release only', async ({ page }) => {
		await page.goto('/');
		await expect(sheet(page)).toBeVisible();
		await expect(sheet(page).getByRole('heading', { level: 3 })).toHaveCount(1);
		await expect(sheet(page)).toContainText(CHANGELOG[0].version);
	});
});

test.describe('a first install', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('sees the guide, not what is new, then or after', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'Welcome to Trolay' })).toBeVisible();
		await expect(sheet(page)).toBeHidden();
		await page.getByRole('button', { name: 'Skip the guide' }).click();
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
		await expect(sheet(page)).toBeHidden();
	});
});

test('Settings › About › What’s new lists every release', async ({ page }) => {
	await page.goto('/settings/about');
	await page.getByRole('link', { name: "What's new" }).click();
	await expect(page.getByRole('heading', { name: "What's new", level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { level: 2 })).toHaveCount(CHANGELOG.length);
	await page.getByRole('link', { name: 'Back to About' }).click();
	await expect(page).toHaveURL(/\/settings\/about$/);
});
