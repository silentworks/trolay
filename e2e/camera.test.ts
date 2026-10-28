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

const READ_TIMEOUT = { timeout: 30_000 };
const OPEN_FOOD_FACTS = 'https://world.openfoodfacts.org/api/v2/product/**';

// Never reach the real Open Food Facts from tests; by default it doesn't list the product.
test.beforeEach(async ({ page }) => {
	await page.route(OPEN_FOOD_FACTS, (route) => route.fulfill({ status: 404, json: { status: 0 } }));
});

async function listOnOpenFoodFacts(page: Page, product: object) {
	await page.unroute(OPEN_FOOD_FACTS);
	await page.route(OPEN_FOOD_FACTS, (route) => route.fulfill({ json: { status: 1, product } }));
}

async function snapLabel(page: Page) {
	await page.getByRole('button', { name: 'Snap label' }).click();
	const camera = page.getByRole('dialog', { name: 'Snap a shelf label' });
	await expect(camera.getByText('Fill the frame with the shelf label')).toBeVisible();
	await expect(camera.getByRole('status')).toHaveText(`Barcode ${BARCODE} ✓`, READ_TIMEOUT);
	await camera.getByRole('button', { name: 'Take photo' }).click();
	return page.getByRole('dialog', { name: 'Check the label' });
}

test('snap a label: it is read into the review sheet, and edits can be reverted', async ({
	page
}) => {
	await startTrip(page);
	const review = await snapLabel(page);

	await expect(review.getByRole('img', { name: 'The label you photographed' })).toBeVisible();
	await expect(review.getByText('Read from the label. Check before adding.')).toBeVisible(
		READ_TIMEOUT
	);
	await expect(review.getByLabel('Description')).toHaveValue('Semi Skimmed Milk 2.272L 4 Pints');
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('1.45');
	await expect(review.getByLabel('Price includes VAT')).toBeChecked();
	await expect(review.getByLabel('Barcode (optional)')).toHaveValue(BARCODE);
	await review.getByRole('button', { name: 'Add to cart' }).click();
	await expect(review).toBeHidden();

	// Changing a value read from the label marks the item as edited; revert puts it back.
	await page.getByRole('button', { name: /^Semi Skimmed Milk/ }).click();
	const edit = page.getByRole('dialog', { name: 'Edit item' });
	await edit.getByLabel('Unit price (£)').fill('1.55');
	await edit.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('edited')).toBeVisible();
	await page.getByRole('button', { name: /^Semi Skimmed Milk/ }).click();
	await edit.getByRole('button', { name: 'Revert to label reading' }).click();
	await expect(page.getByText('edited')).toBeHidden();
	await expect(page.getByRole('button', { name: /^Semi Skimmed Milk.*£1\.45 each/ })).toBeVisible();
});

test('fields the reader could not read are left empty and highlighted', async ({ page }) => {
	await startTrip(page);
	await page.getByRole('button', { name: 'Snap label' }).click();
	const camera = page.getByRole('dialog', { name: 'Snap a shelf label' });
	// The big "99p" on this label is not read, so the price must be typed.
	await camera.locator('input[type=file]').setInputFiles('fixtures/labels/synthetic-13-banded.png');

	const review = page.getByRole('dialog', { name: 'Check the label' });
	await expect(review.getByText("Couldn't read the price. Please type it.")).toBeVisible(
		READ_TIMEOUT
	);
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('');
	await expect(review.getByLabel('Description')).toHaveValue('Porridge Oats 1kg');
	await review.getByLabel('Unit price (£)').fill('0.99');
	await expect(review.getByText("Couldn't read the price. Please type it.")).toBeHidden();
	await review.getByRole('button', { name: 'Add to cart' }).click();
	await expect(page.getByRole('button', { name: /^Porridge Oats 1kg £0\.99/ })).toBeVisible();
});

test('labels are read with no signal once the app has loaded', async ({ page, context }) => {
	await startTrip(page);
	// The service worker caches the label reader's files on install.
	await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		while (registration.active?.state !== 'activated') await new Promise((r) => setTimeout(r, 50));
		while (!(await caches.has('trolay-ocr'))) await new Promise((r) => setTimeout(r, 50));
		const cache = await caches.open('trolay-ocr');
		while ((await cache.keys()).length < 3) await new Promise((r) => setTimeout(r, 50));
	});
	await context.setOffline(true);
	await page.reload();

	const review = await snapLabel(page);
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('1.45', READ_TIMEOUT);
});

test('scan a barcode into an item typed by hand', async ({ page }) => {
	await listOnOpenFoodFacts(page, {
		brands: 'Dairy Co',
		product_name: 'Semi Skimmed Milk',
		quantity: '2.272 L'
	});
	await startTrip(page);
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByRole('button', { name: 'Scan' }).click();

	await expect(page.getByRole('dialog', { name: 'Scan a barcode' })).toBeHidden({
		timeout: 15_000
	});
	await expect(sheet.getByLabel('Barcode (optional)')).toHaveValue(BARCODE);
	await expect(sheet.getByLabel('Description')).toHaveValue('Dairy Co Semi Skimmed Milk 2.272 L');
	await expect(sheet.getByText('Name from Open Food Facts.')).toBeVisible();
});

test('a name you gave the barcode before beats the label reading', async ({ page }) => {
	await startTrip(page);
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByLabel('Description').fill('Milk for tea');
	await sheet.getByLabel('Unit price (£)').fill('1.45');
	await sheet.getByLabel('Barcode (optional)').fill(BARCODE);
	await sheet.getByRole('button', { name: 'Add to cart' }).click();
	await expect(sheet).toBeHidden();

	const review = await snapLabel(page);
	await expect(review.getByText('Read from the label. Check before adding.')).toBeVisible(
		READ_TIMEOUT
	);
	await expect(review.getByLabel('Description')).toHaveValue('Milk for tea');
	await expect(review.getByText('Name from your earlier shopping.')).toBeVisible();
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('1.45');
});

test('a barcode scanned with no signal is named once the signal returns', async ({
	page,
	context
}) => {
	await startTrip(page);
	await context.setOffline(true);
	// Routes still answer while offline, so make the lookup fail as it would with no signal.
	await page.unroute(OPEN_FOOD_FACTS);
	await page.route(OPEN_FOOD_FACTS, (route) => route.abort('internetdisconnected'));
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByRole('button', { name: 'Scan' }).click();
	await expect(sheet.getByLabel('Barcode (optional)')).toHaveValue(BARCODE, READ_TIMEOUT);
	await expect(sheet.getByText(/No signal\. Leave it blank/)).toBeVisible();
	await sheet.getByLabel('Unit price (£)').fill('1.45');
	await sheet.getByRole('button', { name: 'Add to cart' }).click();
	await expect(
		page.getByRole('button', { name: `Unnamed item ${BARCODE} £1.45 each incl. VAT` })
	).toBeVisible();

	await listOnOpenFoodFacts(page, { brands: 'Dairy Co', product_name: 'Semi Skimmed Milk' });
	await context.setOffline(false);
	await expect(
		page.getByRole('button', { name: /^Dairy Co Semi Skimmed Milk £1\.45/ })
	).toBeVisible();
});
