import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/** Presses the plus on the shopping screen and picks a way to add an item. */
async function addBy(page: Page, way: 'Snap label' | 'Add by hand') {
	await page.getByRole('button', { name: 'Add an item' }).click();
	await page.getByRole('group', { name: 'Add an item' }).getByRole('button', { name: way }).click();
}

// A new deploy is simulated by changing the version baked into the built service worker that
// the preview server serves. Same length, so the server's cached file size still fits.
const WORKER = '.svelte-kit/output/client/service-worker.js';
const VERSION = /version:`(\d+)`/;

function deploy(): () => void {
	const original = readFileSync(WORKER, 'utf8');
	const current = VERSION.exec(original)![1];
	const next = String(Number(current) + 1).padStart(current.length, '0');
	writeFileSync(WORKER, original.replace(VERSION, `version:\`${next}\``));
	return () => writeFileSync(WORKER, original);
}

const prompt = (page: Page) => page.getByRole('complementary', { name: 'App update' });
const cacheNames = (page: Page) => page.evaluate(() => caches.keys());

async function startShop(page: Page) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await addBy(page, 'Add by hand');
	await page.getByLabel('Description').fill('Milk');
	await page.getByLabel('Unit price (£)').fill('1.45');
	await page.getByRole('button', { name: 'Add to cart' }).click();
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload(); // now controlled by the service worker
	await expect(page.getByRole('button', { name: /^Milk £/ })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('a new version waits for "Refresh to update" and never reloads mid-shop', async ({ page }) => {
	await startShop(page);
	await expect(prompt(page)).toBeHidden();
	const before = await cacheNames(page);
	// Marks this page load: a reload would wipe it.
	await page.evaluate(() => ((window as unknown as { mark: number }).mark = 1));

	const restore = deploy();
	try {
		await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
		await expect(prompt(page)).toContainText('A new version of Trolay is ready.', {
			timeout: 30_000
		});
		// Installed and waiting, but the page was left alone.
		await page.waitForTimeout(1000);
		expect(await page.evaluate(() => (window as unknown as { mark?: number }).mark)).toBe(1);

		await prompt(page).getByRole('button', { name: 'Refresh to update' }).click();
		await page.waitForFunction(() => !(window as unknown as { mark?: number }).mark);
		await expect(page.getByRole('button', { name: /^Milk £/ })).toBeVisible();
		await expect(prompt(page)).toBeHidden();
		// The new version took over: it replaced the old version's cache with its own.
		const after = await cacheNames(page);
		expect(after.filter((name) => !before.includes(name))).toHaveLength(1);
		expect(after.filter((name) => before.includes(name))).toEqual(['trolay-ocr']);
	} finally {
		restore();
	}
});

test('dismissed, the update applies the next time the app is opened', async ({ context, page }) => {
	await startShop(page);
	const before = await cacheNames(page);
	const restore = deploy();
	try {
		await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
		await prompt(page).getByRole('button', { name: 'Later' }).click({ timeout: 30_000 });
		await expect(prompt(page)).toBeHidden();
		// The old version is still in charge: activating the new one would delete its cache.
		const oldCache = before.find((name) => name !== 'trolay-ocr')!;
		expect(await cacheNames(page)).toContain(oldCache);

		// Closing the app lets the waiting version take over; it is in use on the next launch.
		await page.close();
		const next = await context.newPage();
		await next.goto('/');
		await expect(next.getByRole('button', { name: /^Milk £/ })).toBeVisible();
		await expect.poll(() => cacheNames(next)).not.toContain(oldCache);
		await expect(prompt(next)).toBeHidden();
	} finally {
		restore();
	}
});
