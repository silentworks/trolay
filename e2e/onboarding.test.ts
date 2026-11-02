import { expect, test } from '@playwright/test';

// A phone opening Trolay for the first time.
test.use({ storageState: { cookies: [], origins: [] } });

test('the guide sets up the first store and trip, keeping what was typed on Back', async ({
	page
}) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Welcome to Trolay' })).toBeVisible();
	await expect(page.getByText('If you sign in, your stores and history sync')).toBeVisible();
	await page.getByRole('button', { name: 'Get started' }).click();

	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeFocused();
	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByRole('alert')).toContainText('Enter the name of the store');
	// Guessed from the phone's region (en-GB in these tests).
	await expect(page.getByLabel('Currency')).toHaveValue('GBP');
	await page.getByLabel('Store name').fill('Lidl');
	await page.getByLabel(/Branch or location/).fill('Hackney');
	await page.getByRole('button', { name: 'Next' }).click();

	await expect(page.getByRole('heading', { name: 'Sales tax at Lidl' })).toBeFocused();
	await expect(page.getByLabel('Sales tax rate (%)')).toHaveValue('20');
	await expect(page.getByLabel('Yes, the price on the shelf is what I pay')).toBeChecked();
	await page.getByRole('button', { name: 'Back' }).click();
	await expect(page.getByLabel('Store name')).toHaveValue('Lidl');
	await page.getByRole('button', { name: 'Next' }).click();
	await page.getByRole('button', { name: 'Next' }).click();

	await expect(page.getByRole('heading', { name: 'Set a budget for this trip?' })).toBeFocused();
	await page.getByLabel(/Budget/).fill('40');
	await page.getByRole('button', { name: 'Next' }).click();

	await expect(page.getByRole('heading', { name: 'How a trip works' })).toBeFocused();
	await expect(page.getByText('enter the total on your receipt')).toBeVisible();
	await page.getByRole('button', { name: 'Start shopping' }).click();

	await expect(page.getByRole('button', { name: 'Store: Lidl' })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Trolley total' })).toContainText('40.00');

	// Done: a reload stays on the trolley, and the store was made once.
	await page.reload();
	await expect(page.getByRole('button', { name: 'Store: Lidl' })).toBeVisible();
	await page.goto('/stores');
	await expect(page.getByText('Lidl')).toHaveCount(1);
});

test('skipping the guide leads to the start screen, and it does not come back', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Get started' }).click();
	await page.getByLabel('Store name').fill('Aldi');
	await page.getByRole('button', { name: 'Skip the guide' }).click();
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Add a new store' })).toBeVisible();
	await page.goto('/stores');
	await expect(page.getByText('No stores yet.')).toBeVisible();

	await page.goto('/');
	await expect(page.getByRole('button', { name: 'Add a new store' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Welcome to Trolay' })).toHaveCount(0);
});

test('the guide can be opened again from Account, and only explains during a trip', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Skip the guide' }).click();
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(page.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();

	await page.goto('/account');
	await page.getByRole('link', { name: 'Show the getting started guide' }).click();
	await expect(page.getByText('Step 1 of 2')).toBeVisible();
	await page.getByRole('button', { name: 'Get started' }).click();
	await expect(page.getByRole('heading', { name: 'How a trip works' })).toBeVisible();
	await page.getByRole('button', { name: 'Back to your trolley' }).click();
	await expect(page.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();
	await page.goto('/stores');
	await expect(page.getByText('Tesco')).toHaveCount(1);
});
