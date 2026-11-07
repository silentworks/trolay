import { expect, test, type Page } from '@playwright/test';

const noStores = (page: Page) =>
	page.getByRole('button', {
		name: "No stores yet. Add the store you're in to start your first trip."
	});

test('with no stores, a card says so and adds the first store', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Your stores' })).toHaveCount(0);
	// The budget is set in the trolley or the guide, not here.
	await expect(page.getByLabel(/Budget/)).toHaveCount(0);

	await noStores(page).click();
	const sheet = page.getByRole('dialog', { name: 'New store' });
	await expect(sheet).toBeVisible();
	await sheet.getByLabel('Store name').fill('Lidl');
	await sheet.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(page.getByRole('button', { name: 'Store: Lidl' })).toBeVisible();

	// Back on the start screen, the store is listed and the card has gone.
	await page.getByRole('button', { name: 'Menu' }).click();
	await page
		.getByRole('navigation', { name: 'Menu' })
		.getByText('Leave store', { exact: true })
		.click();
	await expect(page.getByRole('heading', { name: 'Your stores' })).toBeVisible();
	await expect(page.getByRole('button', { name: /Lidl/ })).toBeVisible();
	await expect(noStores(page)).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Add a new store' })).toBeVisible();
});
