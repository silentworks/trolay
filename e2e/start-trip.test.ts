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

test('the Stores page shows the same card with no stores, and adds one', async ({ page }) => {
	await page.goto('/stores');
	const card = page.getByRole('button', {
		name: 'No stores yet. Add the stores you shop at, with their sales tax.'
	});
	await card.click();
	const sheet = page.getByRole('dialog', { name: 'New store' });
	await sheet.getByLabel('Store name').fill('Aldi');
	await sheet.getByRole('button', { name: 'Add store' }).click();
	await expect(page.getByRole('button', { name: /Aldi/ })).toBeVisible();
	await expect(card).toHaveCount(0);
});

test('the store sheet sets whether shelf prices include tax with a switch', async ({ page }) => {
	await page.goto('/stores');
	await page.getByRole('button', { name: /^No stores yet/ }).click();
	const sheet = page.getByRole('dialog', { name: 'New store' });
	await expect(sheet.getByLabel('Store name')).toBeFocused();
	const tax = sheet.getByRole('switch', { name: 'Shelf prices include sales tax' });
	// Guessed from the phone's region (en-GB in these tests).
	await expect(tax).toBeChecked();
	await expect(tax).toHaveText('Include tax');
	await tax.click();
	await expect(tax).not.toBeChecked();
	await expect(tax).toHaveText('Tax at the till');
	await sheet.getByLabel('Store name').fill('Costco');
	await sheet.getByRole('button', { name: 'Add store' }).click();

	await page.getByRole('button', { name: /Costco/ }).click();
	await expect(
		page.getByRole('dialog').getByRole('switch', { name: 'Shelf prices include sales tax' })
	).not.toBeChecked();
});
