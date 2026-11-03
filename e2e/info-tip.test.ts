import { expect, test } from '@playwright/test';

// A phone's width, where a card has least room.
test.use({ viewport: { width: 360, height: 740 } });

async function startTrip(page: import('@playwright/test').Page) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(page.getByRole('region', { name: 'Trolley total' })).toBeVisible();
}

test('an ⓘ opens its explanation on a tap, inside the screen, and closes the usual ways', async ({
	page
}) => {
	await startTrip(page);
	await page.getByRole('button', { name: 'Set a budget' }).click();
	const sheet = page.getByRole('dialog', { name: 'Trip budget' });
	const info = sheet.getByRole('button', { name: 'About budget' });
	const card = page.getByRole('note').filter({ hasText: 'Budget' });

	// Hidden until asked for.
	await expect(card).toBeHidden();
	await expect(info).toHaveAttribute('aria-expanded', 'false');
	await info.click();
	await expect(card).toBeVisible();
	await expect(card).toContainText('against your total incl. tax');
	await expect(info).toHaveAttribute('aria-expanded', 'true');
	// It fits on the screen, beside the button: below it, or above when there is no room below
	// (as here, in a sheet at the foot of the screen).
	const box = (await card.boundingBox())!;
	const button = (await info.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(16);
	expect(box.x + box.width).toBeLessThanOrEqual(360 - 16);
	expect(box.y).toBeGreaterThanOrEqual(16);
	expect(box.y + box.height).toBeLessThanOrEqual(740 - 16);
	const below = box.y >= button.y + button.height;
	const above = box.y + box.height <= button.y;
	expect(below || above).toBe(true);

	// A second tap closes it; so do Escape and a tap elsewhere, which leave the sheet open.
	await info.click();
	await expect(card).toBeHidden();
	await info.click();
	await page.keyboard.press('Escape');
	await expect(card).toBeHidden();
	await expect(sheet).toBeVisible();
	await info.click();
	await sheet.getByLabel(/^Budget/).click();
	await expect(card).toBeHidden();
	await expect(sheet).toBeVisible();
	await expect(info).toHaveAttribute('aria-expanded', 'false');
});

test('only one explanation is open at a time', async ({ page }) => {
	await startTrip(page);
	await page.goto('/stores');
	await page.getByRole('button', { name: /^Tesco/ }).click();
	const form = page.getByRole('dialog');
	await form.getByRole('button', { name: 'About currency' }).click();
	const currency = page.getByRole('note').filter({ hasText: 'Currency' });
	await expect(currency).toContainText('past trips are shown too');
	await form.getByRole('button', { name: 'About shelf prices and sales tax' }).click();
	await expect(
		page.getByRole('note').filter({ hasText: 'Shelf prices and sales tax' })
	).toBeVisible();
	await expect(currency).toBeHidden();
});
