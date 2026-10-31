import { expect, test, type Page } from '@playwright/test';

async function finishedTripAt(page: Page, store: string) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill(store);
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByLabel('Description').fill('Milk');
	await sheet.getByLabel('Unit price (£)').fill('1.45');
	await sheet.getByRole('button', { name: 'Add to cart' }).click();
	await page.getByRole('button', { name: 'Menu' }).click();
	await page
		.getByRole('navigation', { name: 'Menu' })
		.getByText('Finish trip', { exact: true })
		.click();
	const finish = page.getByRole('dialog', { name: 'Finish trip' });
	await finish.getByLabel('Receipt total (£)').fill('1.45');
	await finish.getByRole('button', { name: 'Finish trip' }).click();
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
}

test('a trip is deleted from its history page', async ({ page }) => {
	await finishedTripAt(page, 'Asda');
	await page.goto('/history');
	await page.getByRole('link', { name: /Asda/ }).click();
	await page.getByRole('button', { name: 'Menu' }).click();
	await page.getByRole('navigation', { name: 'Menu' }).getByText('Delete this trip').click();
	await page
		.getByRole('dialog', { name: 'Delete this trip?' })
		.getByRole('button', { name: 'Delete trip' })
		.click();
	await expect(page.getByText('No finished trips yet')).toBeVisible();
});

test('all history is deleted at once, and a store with its history', async ({ page }) => {
	await finishedTripAt(page, 'Asda');
	await finishedTripAt(page, 'Aldi');
	await page.goto('/history');
	await expect(page.getByRole('list', { name: 'Past trips' }).getByRole('link')).toHaveCount(2);
	await page.getByRole('button', { name: 'Menu' }).click();
	await page.getByRole('navigation', { name: 'Menu' }).getByText('Delete all history').click();
	await page
		.getByRole('dialog', { name: 'Delete all history?' })
		.getByRole('button', { name: 'Delete all history' })
		.click();
	await expect(page.getByText('No finished trips yet')).toBeVisible();

	await finishedTripAt(page, 'Lidl');
	await page.goto('/stores');
	await page.getByRole('button', { name: /Lidl/ }).click();
	await page.getByRole('button', { name: 'Delete store' }).click();
	await page.getByRole('button', { name: 'Delete store and its history' }).click();
	await expect(page.getByRole('button', { name: /Lidl/ })).toHaveCount(0);
	await page.goto('/history');
	await expect(page.getByText('No finished trips yet')).toBeVisible();
});
