import { expect, test } from '@playwright/test';

test('a multi-buy offer sets the line total once there are enough items', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();

	await page.getByRole('button', { name: 'Add by hand' }).click();
	const add = page.getByRole('dialog', { name: 'Add item' });
	await add.getByLabel('Description').fill('Bread');
	await add.getByLabel('Unit price (£)').fill('1.89');
	await add.getByLabel('Offer: number of items').fill('2');
	await add.getByLabel('Offer: price for the items').fill('3');
	await add.getByRole('button', { name: 'Increase quantity' }).click();
	await expect(add).toContainText('Line total £3.00 incl. VAT');
	await add.getByRole('button', { name: 'Add to cart' }).click();

	const footer = page.getByRole('region', { name: 'Trolley total' });
	const row = page.getByRole('list', { name: 'Items in your trolley' }).getByRole('listitem');
	await expect(row).toContainText('2 for £3.00');
	await expect(footer).toContainText('£3.00');

	// A third costs the single price on top of the offer.
	await row.getByRole('button', { name: 'Increase quantity' }).click();
	await expect(footer).toContainText('£4.89');
	// Back to one: no offer applies.
	await row.getByRole('button', { name: 'Decrease quantity' }).click();
	await row.getByRole('button', { name: 'Decrease quantity' }).click();
	await expect(footer).toContainText('£1.89');

	// Half an offer is refused.
	await row.getByRole('button', { name: /^Bread/ }).click();
	const edit = page.getByRole('dialog', { name: 'Edit item' });
	await edit.getByLabel('Offer: price for the items').fill('');
	await edit.getByRole('button', { name: 'Save changes' }).click();
	await expect(edit.getByRole('alert')).toContainText('multi-buy offer');
});
