import { expect, test, type Page } from '@playwright/test';
import { copyPasskeys, withPasskeys } from './passkeys';

async function addItem(page: Page, description: string, price: string) {
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByLabel('Description').fill(description);
	await sheet.getByLabel('Unit price (£)').fill(price);
	await sheet.getByRole('button', { name: 'Add to cart' }).click();
	await expect(sheet).toBeHidden();
}

const synced = (page: Page) => page.getByRole('status').filter({ hasText: '✓ Synced' });

test('what one phone does appears on the other, and back', async ({ browser }) => {
	// Phone A: shop without an account, then make one. What is already there is uploaded.
	const a = await (await browser.newContext({ baseURL: 'http://localhost:4173' })).newPage();
	const passkeysA = await withPasskeys(a);
	await a.goto('/');
	await a.getByRole('button', { name: 'Add a new store' }).click();
	await a.getByLabel('Store name').fill('Tesco');
	await a.getByRole('button', { name: 'Add store and start trip' }).click();
	await addItem(a, 'Milk', '1.50');

	await a.goto('/account');
	await a.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(synced(a)).toBeVisible();

	// Phone B: the same passkey, a different phone with nothing on it.
	const b = await (await browser.newContext({ baseURL: 'http://localhost:4173' })).newPage();
	await copyPasskeys(passkeysA, await withPasskeys(b));
	await b.goto('/account');
	await b.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(synced(b)).toBeVisible();

	// The trip is open on B, with the item from A.
	await b.goto('/');
	await expect(b.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();
	await expect(b.getByText('Milk')).toBeVisible();

	// B adds an item, and A has it after it next looks.
	await addItem(b, 'Bread', '0.95');
	await b.goto('/account');
	await expect(synced(b)).toBeVisible();
	await a.goto('/');
	await expect(a.getByText('Bread')).toBeVisible();
	await expect(a.getByText('Milk')).toBeVisible();
});

test('changes made with no signal wait, and are sent when it returns', async ({ browser }) => {
	const context = await browser.newContext({ baseURL: 'http://localhost:4173' });
	const page = await context.newPage();
	await withPasskeys(page);
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Aldi');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(page.getByRole('button', { name: 'Store: Aldi' })).toBeVisible();
	await page.goto('/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(synced(page)).toBeVisible();

	// Offline: the account page is served by the service worker, and the change waits.
	await page.goto('/');
	await addItem(page, 'Eggs', '2.10');
	await context.setOffline(true);
	await addItem(page, 'Butter', '1.80');
	await page.goto('/account');
	await expect(
		page.getByRole('status').filter({ hasText: /waiting to sync|Offline/ })
	).toBeVisible();

	await context.setOffline(false);
	// A browser sends this when the signal returns; Playwright's offline mode does not.
	await page.evaluate(() => window.dispatchEvent(new Event('online')));
	await expect(synced(page)).toBeVisible();
});
