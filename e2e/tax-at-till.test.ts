import { expect, test } from '@playwright/test';
import { menu } from './shared';

test.describe('on a US phone', () => {
	test.use({ locale: 'en-US', storageState: { cookies: [], origins: [] } });

	test('the guide sets up a store whose till adds sales tax, and the receipt matches', async ({
		page
	}) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Get started' }).click();
		await page.getByLabel('Store name').fill('Target');
		await page.getByRole('button', { name: 'Next' }).click();

		await expect(page.getByLabel('No, tax is added at the till')).toBeChecked();
		await expect(page.getByLabel('Sales tax rate (%)')).toHaveValue('0');
		await expect(page.getByText('Sales tax depends on where you shop.')).toBeVisible();
		await page.getByLabel('Sales tax rate (%)').fill('8');
		await page.getByRole('button', { name: 'Next' }).click();
		await page.getByRole('button', { name: 'No budget' }).click();
		await page.getByRole('button', { name: 'Start shopping' }).click();

		await page.getByRole('button', { name: 'Add by hand' }).click();
		const add = page.getByRole('dialog', { name: 'Add item' });
		await add.getByLabel('Description').fill('Paper towels');
		await add.getByLabel('Unit price ($)').fill('10');
		await expect(add.getByLabel('Price includes tax')).not.toBeChecked();
		await add.getByRole('button', { name: 'Add to cart' }).click();

		const footer = page.getByRole('region', { name: 'Trolley total' });
		await expect(footer.getByRole('button', { name: /Total \$10\.80 incl\. tax/ })).toBeVisible();
		await expect(footer).toContainText('Tax (added at till)');
		await expect(footer).toContainText('$0.80');

		await menu(page, 'Finish trip');
		const finish = page.getByRole('dialog', { name: 'Finish trip' });
		await finish.getByLabel('Receipt total ($)').fill('10.80');
		await expect(finish).toContainText('✓ The receipt matches.');
		await finish.getByRole('button', { name: 'Finish trip' }).click();
		await expect(page.getByRole('status')).toHaveText('Trip saved. See it in History');
	});
});

test('a receipt higher by about the sales tax asks whether the till added it', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Corner Shop');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const add = page.getByRole('dialog', { name: 'Add item' });
	await add.getByLabel('Description').fill('Tea');
	await add.getByLabel('Unit price').fill('10');
	await add.getByRole('button', { name: 'Add to cart' }).click();

	await menu(page, 'Finish trip');
	const finish = page.getByRole('dialog', { name: 'Finish trip' });
	// 20% (the UK rate this en-GB phone guessed) on 10.00.
	await finish.getByLabel('Receipt total').fill('12.00');
	await expect(finish).toContainText('Did the till add sales tax?');
	await finish.getByLabel('Receipt total').fill('10.50');
	await expect(finish).toContainText('The till charged 0.50 more');
	await expect(finish).not.toContainText('Did the till add sales tax?');
});
