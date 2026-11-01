import { expect, test, type Page } from '@playwright/test';

async function menu(page: Page, entry: string) {
	await page.getByRole('button', { name: 'Menu' }).click();
	await page.getByRole('navigation', { name: 'Menu' }).getByText(entry, { exact: true }).click();
}

test('a discount comes off the trolley total, the receipt check and the history', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const add = page.getByRole('dialog', { name: 'Add item' });
	await add.getByLabel('Description').fill('Wine');
	await add.getByLabel('Unit price (£)').fill('6');
	await add.getByRole('button', { name: 'Add to cart' }).click();
	const footer = page.getByRole('region', { name: 'Trolley total' });
	await expect(footer).toContainText('£6.00');

	// 10% off.
	await menu(page, 'Add discount');
	const sheet = page.getByRole('dialog', { name: 'Discount' });
	await sheet.getByRole('button', { name: 'Percent (%)' }).click();
	await sheet.getByLabel('Discount (%)').fill('10');
	await sheet.getByRole('button', { name: 'Save discount' }).click();
	await expect(footer).toContainText('Discount (10%)');
	await expect(footer).toContainText('−£0.60');
	await expect(footer).toContainText('£5.40');

	// Changed to £1.50 off.
	await menu(page, 'Change discount');
	await sheet.getByRole('button', { name: 'Amount (£)' }).click();
	await sheet.getByLabel('Discount (£)').fill('1.5');
	await sheet.getByRole('button', { name: 'Save discount' }).click();
	await expect(footer).toContainText('−£1.50');
	await expect(footer).toContainText('£4.50');

	// A discount bigger than the total stops at £0.
	await menu(page, 'Change discount');
	await sheet.getByLabel('Discount (£)').fill('50');
	await sheet.getByRole('button', { name: 'Save discount' }).click();
	await expect(footer).toContainText('−£6.00');
	await expect(footer).toContainText('£0.00');

	// Back to 10%, and the till agrees with the discounted total.
	await menu(page, 'Change discount');
	await sheet.getByRole('button', { name: 'Percent (%)' }).click();
	await sheet.getByLabel('Discount (%)').fill('10');
	await sheet.getByRole('button', { name: 'Save discount' }).click();
	await menu(page, 'Finish trip');
	const finish = page.getByRole('dialog', { name: 'Finish trip' });
	await finish.getByLabel('Receipt total (£)').fill('5.40');
	await expect(finish).toContainText('✓ The receipt matches.');
	await finish.getByRole('button', { name: 'Finish trip' }).click();

	await expect(page.getByRole('status')).toHaveText('Trip saved. See it in History');
	await page.goto('/history');
	const trip = page.getByRole('list', { name: 'Past trips' }).getByRole('link');
	await expect(trip).toContainText('£5.40');
	await expect(trip).toContainText('✓ Receipt matched');
	await trip.click();
	await expect(page.getByLabel('Trip totals')).toContainText('Discount taken off');
	await expect(page.getByLabel('Trip totals')).toContainText('−£0.60');

	// Removing it on an open trip puts the total back.
	await page.goto('/');
	await page.getByRole('button', { name: /^Tesco/ }).click();
	await page.getByRole('button', { name: 'Add by hand' }).click();
	await add.getByLabel('Description').fill('Bread');
	await add.getByLabel('Unit price (£)').fill('1');
	await add.getByRole('button', { name: 'Add to cart' }).click();
	await menu(page, 'Add discount');
	await sheet.getByLabel('Discount (£)').fill('0.5');
	await sheet.getByRole('button', { name: 'Save discount' }).click();
	await expect(footer).toContainText('£0.50');
	await menu(page, 'Change discount');
	await sheet.getByRole('button', { name: 'Remove discount' }).click();
	await expect(footer).not.toContainText('Discount');
	await expect(footer).toContainText('£1.00');
});
