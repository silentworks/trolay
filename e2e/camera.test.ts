import { expect, test, type Page } from '@playwright/test';

// The fake camera shows fixtures/labels/synthetic-01-classic.png:
// "Semi Skimmed Milk 2.272L 4 Pints", £1.45, barcode 5012345678900.
const BARCODE = '5012345678900';

async function startTrip(page: Page) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(page.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();
}

test('snap a label: the barcode in view comes along with the photo', async ({ page }) => {
	await startTrip(page);
	await page.getByRole('button', { name: 'Snap label' }).click();

	const camera = page.getByRole('dialog', { name: 'Snap a shelf label' });
	await expect(camera.getByText('Fill the frame with the shelf label')).toBeVisible();
	await expect(camera.getByRole('status')).toHaveText(`Barcode ${BARCODE} ✓`, { timeout: 15_000 });
	await camera.getByRole('button', { name: 'Take photo' }).click();

	const review = page.getByRole('dialog', { name: 'Check the label' });
	await expect(review.getByRole('img', { name: 'The label you photographed' })).toBeVisible();
	await expect(review.getByLabel('Barcode (optional)')).toHaveValue(BARCODE);
	await review.getByLabel('Description').fill('Milk');
	await review.getByLabel('Unit price (£)').fill('1.45');
	await review.getByRole('button', { name: 'Add to cart' }).click();
	await expect(review).toBeHidden();
	await expect(page.getByRole('button', { name: /^Milk £1\.45/ })).toBeVisible();
});

test('scan a barcode into an item typed by hand', async ({ page }) => {
	await startTrip(page);
	await page.getByRole('button', { name: '+ Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByRole('button', { name: 'Scan' }).click();

	await expect(page.getByRole('dialog', { name: 'Scan a barcode' })).toBeHidden({
		timeout: 15_000
	});
	await expect(sheet.getByLabel('Barcode (optional)')).toHaveValue(BARCODE);
});
