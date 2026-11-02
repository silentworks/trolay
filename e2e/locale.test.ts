import { expect, test } from '@playwright/test';

test.use({ locale: 'de-DE' });

test('a German phone types and shows amounts with a decimal comma', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Aldi');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();

	await page.getByRole('button', { name: 'Add by hand' }).click();
	const add = page.getByRole('dialog', { name: 'Add item' });
	await add.getByLabel('Description').fill('Kaffee');
	// Ambiguous: a thousands mark in English, three decimals in German. Refused, not guessed.
	await add.getByLabel('Unit price (£)').fill('1,234');
	await add.getByRole('button', { name: 'Add to cart' }).click();
	await expect(add.getByRole('alert')).toContainText('Enter a price like 1,45.');

	await add.getByLabel('Unit price (£)').fill('4,50');
	await add.getByRole('button', { name: 'Add to cart' }).click();
	const footer = page.getByRole('region', { name: 'Trolley total' });
	await expect(footer).toContainText('4,50 £');

	await page.getByRole('button', { name: 'Increase quantity' }).click();
	await expect(footer).toContainText('9,00 £');

	// The edit form shows the price back the German way.
	await page
		.getByRole('button', { name: /Kaffee/ })
		.first()
		.click();
	await expect(
		page.getByRole('dialog', { name: 'Edit item' }).getByLabel('Unit price (£)')
	).toHaveValue('4,50');
});
