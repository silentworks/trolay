import { expect, test, type Page } from '@playwright/test';
import { menu } from './shared';

/** Shops at a new store, adds one item and finishes against a matching receipt. */
async function shop(page: Page, store: string, currency: string, symbol: string, price: string) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill(store);
	await page.getByLabel(/Currency/).selectOption(currency);
	await page.getByRole('button', { name: 'Add store and start trip' }).click();

	await page.getByRole('button', { name: 'Add by hand' }).click();
	const add = page.getByRole('dialog', { name: 'Add item' });
	await add.getByLabel('Description').fill('Bread');
	await add.getByLabel(`Unit price (${symbol})`).fill(price);
	await add.getByRole('button', { name: 'Add to cart' }).click();
	await expect(page.getByRole('region', { name: 'Trolley total' })).toContainText(
		`${symbol}${price}`
	);

	await menu(page, 'Finish trip');
	const finish = page.getByRole('dialog', { name: 'Finish trip' });
	await finish.getByLabel(`Receipt total (${symbol})`).fill(price);
	await expect(finish).toContainText('✓ The receipt matches.');
	await finish.getByRole('button', { name: 'Finish trip' }).click();
	await expect(page.getByRole('status')).toHaveText('Trip saved. See it in History');
}

test("each store's trips show its own currency, in the cart, history and the trip page", async ({
	page
}) => {
	await shop(page, 'Lidl', 'EUR', '€', '4.50');
	await shop(page, 'Walmart', 'USD', '$', '3.20');

	await page.goto('/history');
	const trips = page.getByRole('list', { name: 'Past trips' }).getByRole('link');
	await expect(trips.filter({ hasText: 'Lidl' })).toContainText('€4.50');
	await expect(trips.filter({ hasText: 'Walmart' })).toContainText('$3.20');

	await trips.filter({ hasText: 'Lidl' }).click();
	await expect(page.getByLabel('Trip totals')).toContainText('€4.50');

	// A store with no currency still shows pounds; changing it relabels its past trips.
	await page.goto('/stores');
	await page.getByRole('button', { name: /Lidl/ }).click();
	const edit = page.getByRole('dialog', { name: 'Edit store' });
	await expect(edit.getByText('The amounts stay the same.')).toBeVisible();
	await edit.getByLabel(/Currency/).selectOption({ label: 'None' });
	await edit.getByRole('button', { name: 'Save changes' }).click();
	await expect(edit).toBeHidden();
	await page.goto('/history');
	await expect(trips.filter({ hasText: 'Lidl' })).toContainText('4.50');
});
