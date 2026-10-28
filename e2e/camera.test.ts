import { expect, test, type Page } from '@playwright/test';

import { FAKE_CAMERA_BARCODE as BARCODE } from './global-setup';

// The fake camera shows a real shelf label (fixtures/labels/real/uk-cully-sully-chowder.jpg):
// "Cully & Sully Smoked Salmon & Haddock Chowder 400g", £1.99, "49.8p per 100g".
const DESCRIPTION = 'Cully & Sully Smoked Salmon & Haddock Chowder 400g';

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
	await expect(review.getByLabel('Description')).toHaveValue(DESCRIPTION);
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('1.99');
	// £1.99 for 400 g is the 49.8p per 100 g printed on the label.
	await expect(review.getByText('✓ Matches the unit price on the label')).toBeVisible();
	await expect(review.getByLabel('Price includes VAT')).toBeChecked();
	await expect(review.getByLabel('Barcode (optional)')).toHaveValue(BARCODE);
	await review.getByRole('button', { name: 'Add to cart' }).click();
	await expect(review).toBeHidden();

	// Changing a value read from the label marks the item as edited; revert puts it back.
	await page.getByRole('button', { name: /^Cully & Sully/ }).click();
	const edit = page.getByRole('dialog', { name: 'Edit item' });
	await edit.getByLabel('Unit price (£)').fill('2.05');
	await edit.getByRole('button', { name: 'Save changes' }).click();
	await expect(page.getByText('edited')).toBeVisible();
	await page.getByRole('button', { name: /^Cully & Sully/ }).click();
	await edit.getByRole('button', { name: 'Revert to label reading' }).click();
	await expect(page.getByText('edited')).toBeHidden();
	await expect(page.getByRole('button', { name: /^Cully & Sully.*£1\.99 each/ })).toBeVisible();
});

test('fields the reader could not read are left empty and highlighted', async ({ page }) => {
	await startTrip(page);
	await page.getByRole('button', { name: 'Snap label' }).click();
	const camera = page.getByRole('dialog', { name: 'Snap a shelf label' });
	// A real Swedish LCD label: its seven-segment price can't be read with confidence, so it is
	// left for the shopper; the printed name can.
	await camera
		.locator('input[type=file]')
		.setInputFiles('fixtures/labels/real/se-lcd-chipotle.jpg');

	const review = page.getByRole('dialog', { name: 'Check the label' });
	await expect(review.getByText("Couldn't read the price. Please type it.")).toBeVisible(
		READ_TIMEOUT
	);
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('');
	await expect(review.getByLabel('Description')).toHaveValue('Chipotle Chil');
	await review.getByLabel('Unit price (£)').fill('1.69');
	await expect(review.getByText("Couldn't read the price. Please type it.")).toBeHidden();
	await review.getByRole('button', { name: 'Add to cart' }).click();
	await expect(page.getByRole('button', { name: /^Chipotle Chil £1\.69/ })).toBeVisible();
});

test('labels are read with no signal once the app has loaded', async ({ page, context }) => {
	await startTrip(page);
	// The service worker caches the label reader's files on install.
	await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		while (registration.active?.state !== 'activated') await new Promise((r) => setTimeout(r, 50));
		while (!(await caches.has('trolay-ocr'))) await new Promise((r) => setTimeout(r, 50));
		const cache = await caches.open('trolay-ocr');
		while ((await cache.keys()).length < 4) await new Promise((r) => setTimeout(r, 50));
	});
	await context.setOffline(true);
	await page.reload();

	const review = await snapLabel(page);
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('1.99', READ_TIMEOUT);
	await expect(review.getByLabel('Description')).toHaveValue(DESCRIPTION);
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
	await sheet.getByLabel('Description').fill('Chowder for Friday');
	await sheet.getByLabel('Unit price (£)').fill('1.99');
	await sheet.getByLabel('Barcode (optional)').fill(BARCODE);
	await sheet.getByRole('button', { name: 'Add to cart' }).click();
	await expect(sheet).toBeHidden();

	const review = await snapLabel(page);
	await expect(review.getByText('Read from the label. Check before adding.')).toBeVisible(
		READ_TIMEOUT
	);
	await expect(review.getByLabel('Description')).toHaveValue('Chowder for Friday');
	await expect(review.getByText('Name from your earlier shopping.')).toBeVisible();
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('1.99');
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

test('cart rows show the photo; tap for the full photo, retake from the edit sheet', async ({
	page
}) => {
	await startTrip(page);
	const review = await snapLabel(page);
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('1.99', READ_TIMEOUT);
	await review.getByRole('button', { name: 'Add to cart' }).click();

	const thumb = page.getByRole('button', { name: /^Photo of Cully & Sully/ });
	await expect(thumb.locator('img')).toBeVisible();
	const firstThumb = await thumb.locator('img').getAttribute('src');
	await thumb.click();
	const viewer = page.getByRole('dialog', { name: /^Photo of Cully & Sully/ });
	await expect(viewer.locator('img')).toBeVisible();
	expect(
		await viewer.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)
	).toBeGreaterThan(240);
	await viewer.getByRole('button', { name: 'Close photo' }).click();
	await expect(viewer).toBeHidden();

	await page.getByRole('button', { name: /^Cully & Sully/ }).click();
	const edit = page.getByRole('dialog', { name: 'Edit item' });
	await edit.getByRole('button', { name: 'Retake photo' }).click();
	const camera = page.getByRole('dialog', { name: 'Snap a shelf label' });
	await expect(camera.getByRole('button', { name: 'Take photo' })).toBeEnabled();
	await camera.getByRole('button', { name: 'Take photo' }).click();
	await expect(page.getByText('Photo updated')).toBeVisible();
	await edit.getByRole('button', { name: 'Close' }).click();
	await expect(thumb.locator('img')).not.toHaveAttribute('src', firstThumb!);
});

test('reads the receipt total and keeps the photos when it does not match', async ({ page }) => {
	await startTrip(page);
	await snapLabel(page);
	const review = page.getByRole('dialog', { name: 'Check the label' });
	await expect(review.getByLabel('Unit price (£)')).toHaveValue('1.99', READ_TIMEOUT);
	await review.getByRole('button', { name: 'Add to cart' }).click();

	await page.getByRole('button', { name: 'Finish', exact: true }).click();
	const finish = page.getByRole('dialog', { name: 'Finish trip' });
	await finish.getByRole('button', { name: 'Read the receipt' }).click();
	// A real Tesco receipt (fixtures/receipts/real/uk-tesco-1994.jpg): TOTAL 6.71, paid with £7.00
	// cash and £0.29 change, which confirms it.
	await page
		.getByRole('dialog', { name: 'Snap the receipt' })
		.locator('input[type=file]')
		.setInputFiles('fixtures/receipts/real/uk-tesco-1994.jpg');
	await expect(finish.getByLabel('Receipt total (£)')).toHaveValue('6.71', READ_TIMEOUT);
	await expect(finish.getByText('the card and cash lines add up to it')).toBeVisible();
	await expect(finish.getByText('The till charged £4.72 more than Trolay added up.')).toBeVisible();
	await expect(finish.getByText('The 1 label photo will be kept as evidence')).toBeVisible();

	await finish.getByRole('button', { name: 'Finish trip' }).click();
	await expect(page.getByRole('status')).toHaveText(
		'Trip saved. Its photos are kept because the receipt did not match.'
	);
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
});
