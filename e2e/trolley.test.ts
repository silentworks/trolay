import { expect, test, type Page } from '@playwright/test';

const footer = (page: Page) => page.getByRole('region', { name: 'Trolley total' });

async function startTripAtNewStore(page: Page, name: string) {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill(name);
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(page.getByRole('button', { name: `Store: ${name}` })).toBeVisible();
}

async function addItem(page: Page, description: string, price: string, quantity = 1) {
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByLabel('Description').fill(description);
	await sheet.getByLabel('Unit price (£)').fill(price);
	for (let i = 1; i < quantity; i++) {
		await sheet.getByRole('button', { name: 'Increase quantity' }).click();
	}
	await sheet.getByRole('button', { name: 'Add to cart' }).click();
	await expect(sheet).toBeHidden();
}

test('a full trip: add, edit, switch totals, budget, delete with undo, reload', async ({
	page
}) => {
	await startTripAtNewStore(page, 'Tesco');
	await expect(page.getByText('Your trolley is empty.')).toBeVisible();

	// 2 × £1.45 incl. VAT = £2.90; excl. = £2.90 / 1.2 = £2.4167 → £2.42
	await addItem(page, 'Milk 2L', '1.45', 2);
	await expect(footer(page).getByRole('button', { name: /Total £2\.90 incl\. VAT/ })).toBeVisible();
	await expect(footer(page)).toContainText('£2.42');
	await expect(footer(page)).toContainText('£0.48');

	// The headline switches to excl. VAT and stays that way after a reload.
	await footer(page)
		.getByRole('button', { name: /Tap to show/ })
		.click();
	await expect(footer(page).getByRole('button', { name: /Total £2\.42 excl\. VAT/ })).toBeVisible();
	await page.reload();
	await expect(footer(page).getByRole('button', { name: /Total £2\.42 excl\. VAT/ })).toBeVisible();
	await footer(page)
		.getByRole('button', { name: /Tap to show/ })
		.click();

	// Editing recomputes the totals immediately.
	await page.getByRole('button', { name: /^Milk 2L £/ }).click();
	const edit = page.getByRole('dialog', { name: 'Edit item' });
	await edit.getByLabel('Unit price (£)').fill('1.50');
	await edit.getByRole('button', { name: 'Save changes' }).click();
	await expect(footer(page).getByRole('button', { name: /Total £3\.00 incl\. VAT/ })).toBeVisible();

	// Quantity controls on the row.
	await page
		.getByRole('group', { name: 'Quantity of Milk 2L' })
		.getByRole('button', { name: 'Decrease quantity' })
		.click();
	await expect(footer(page).getByRole('button', { name: /Total £1\.50 incl\. VAT/ })).toBeVisible();

	// Budget: £1.60 → £1.50 is 94% → amber.
	await footer(page).getByRole('button', { name: 'Set a budget' }).click();
	await page.getByRole('dialog', { name: 'Trip budget' }).getByLabel('Budget (£)').fill('1.60');
	await page.getByRole('button', { name: 'Save budget' }).click();
	await expect(footer(page)).toHaveAttribute('data-status', 'warning');
	await expect(footer(page)).toContainText('£0.10 left of £1.60');

	// Over budget → red.
	await addItem(page, 'Bread', '1.10');
	await expect(footer(page)).toHaveAttribute('data-status', 'over');
	await expect(footer(page)).toContainText('£1.00 over budget');

	// Delete with undo.
	await page.getByRole('button', { name: 'Delete Bread' }).click();
	await expect(page.getByRole('status')).toContainText('Deleted Bread');
	await page.getByRole('button', { name: 'Undo' }).click();
	await expect(page.getByRole('button', { name: /^Bread £/ })).toBeVisible();
	await expect(footer(page).getByRole('button', { name: /Total £2\.60 incl\. VAT/ })).toBeVisible();

	// Everything survives a reload.
	await page.reload();
	await expect(page.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();
	await expect(footer(page).getByRole('button', { name: /Total £2\.60 incl\. VAT/ })).toBeVisible();
});

test('the store can only change while the cart is empty', async ({ page }) => {
	await page.goto('/stores');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Aldi');
	await page.getByRole('button', { name: 'Add store', exact: true }).click();
	await expect(page.getByRole('button', { name: /^Aldi / })).toBeVisible();

	await startTripAtNewStore(page, 'Lidl');
	await page.getByRole('button', { name: 'Store: Lidl' }).click();
	await page
		.getByRole('dialog', { name: 'Change store' })
		.getByRole('button', { name: /Aldi/ })
		.click();
	await expect(page.getByRole('button', { name: 'Store: Aldi' })).toBeVisible();

	await addItem(page, 'Eggs', '2.10');
	await page.getByRole('button', { name: 'Store: Aldi' }).click();
	await expect(page.getByRole('status')).toContainText('only be changed while the cart is empty');
});

test('works offline after the first visit', async ({ page, context }) => {
	await startTripAtNewStore(page, 'Co-op');
	await addItem(page, 'Apples', '2.00');
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload(); // now controlled by the service worker

	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole('button', { name: 'Store: Co-op' })).toBeVisible();
	await addItem(page, 'Pears', '1.00');
	await expect(footer(page).getByRole('button', { name: /Total £3\.00 incl\. VAT/ })).toBeVisible();

	// Deep links work offline too: the shell routes in the browser.
	await page.goto('/stores');
	await expect(page.getByRole('heading', { name: 'Stores' })).toBeVisible();
	await context.setOffline(false);
});
