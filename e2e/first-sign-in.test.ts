import { expect, test, type Page } from '@playwright/test';
import { copyPasskeys, withPasskeys } from './passkeys';

const synced = (page: Page) => page.getByRole('status').filter({ hasText: '✓ Synced' });

/** A backup file with one finished trip of 120 items: a long history, as if from months of use. */
function longHistory(run: number) {
	const now = 1_790_000_000_000;
	const items = Array.from({ length: 120 }, (_, i) => ({
		id: `item-${run}-${i}`,
		tripId: `trip-${run}`,
		description: `Item ${i}`,
		unitPriceMinor: 100,
		priceIncludesTax: true,
		quantity: 1,
		edited: false,
		createdAt: now + i,
		updatedAt: now + i
	}));
	return {
		app: 'trolay',
		format: 1,
		exportedAt: new Date(now).toISOString(),
		stores: [
			{
				id: `store-${run}`,
				name: 'Costco',
				branch: 'Watford',
				taxRateBps: 2000,
				pricesIncludeTax: true,
				createdAt: now,
				lastUsedAt: now,
				updatedAt: now
			}
		],
		trips: [
			{
				id: `trip-${run}`,
				storeId: `store-${run}`,
				status: 'finished',
				photosKept: false,
				startedAt: now,
				finishedAt: now + 1,
				updatedAt: now + 1,
				totals: { inclMinor: 12000, exclMinor: 10000, itemCount: 120, taxRateBps: 2000 }
			}
		],
		items,
		photos: []
	};
}

test('a long history on the phone is uploaded on first sign-in, with progress; a second phone merges', async ({
	browser
}) => {
	// Record ids are global on the server, so each run needs its own.
	const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const a = await (await browser.newContext({ baseURL: 'http://localhost:4173' })).newPage();
	const passkeysA = await withPasskeys(a);

	// Phone A has months of history, made before it ever signed in.
	await a.goto('/history');
	await a.locator('input[type=file]').setInputFiles({
		name: 'trolay-backup.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(longHistory(run)))
	});
	await a.getByRole('button', { name: 'Replace with the backup' }).click();
	await expect(a.getByText('Backup restored.')).toBeVisible();

	// Signing in uploads it. Slowed a little, so the progress can be seen.
	await a.route('**/api/sync/push', async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 500));
		await route.continue();
	});
	await a.goto('/account');
	await a.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(a.getByRole('status').filter({ hasText: /Uploading \d+ of 122/ })).toBeVisible();
	// (The requests are slowed, so the whole upload takes a few seconds.)
	await expect(synced(a)).toBeVisible({ timeout: 20_000 });

	// Phone B has a trip of its own, started before it signed in.
	const b = await (await browser.newContext({ baseURL: 'http://localhost:4173' })).newPage();
	await copyPasskeys(passkeysA, await withPasskeys(b));
	await b.goto('/');
	await b.getByRole('button', { name: 'Add a new store' }).click();
	await b.getByLabel('Store name').fill('Lidl');
	await b.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(b.getByRole('button', { name: 'Store: Lidl' })).toBeVisible();

	await b.goto('/account');
	await b.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(synced(b)).toBeVisible();

	// B has A's history, and still has its own open trip: nothing was overwritten.
	await b.goto('/history');
	await expect(b.getByText('Costco')).toBeVisible();
	await expect(b.getByText('120 items')).toBeVisible();
	await b.goto('/');
	await expect(b.getByRole('button', { name: 'Store: Lidl' })).toBeVisible();

	// And A, next time it looks, has B's store.
	await a.goto('/stores');
	await expect(a.getByText('Lidl')).toBeVisible();
	await expect(a.getByText('Costco')).toBeVisible();
});
