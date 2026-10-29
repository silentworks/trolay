import { expect, test, type Page } from '@playwright/test';

/** Presses the plus on the shopping screen and picks a way to add an item. */
async function addBy(page: Page, way: 'Snap label' | 'Add by hand') {
	await page.getByRole('button', { name: 'Add an item' }).click();
	await page.getByRole('group', { name: 'Add an item' }).getByRole('button', { name: way }).click();
}

/** Picks an entry from the shopping screen's ⋮ menu. */
async function menu(page: Page, entry: 'History' | 'Stores' | 'Finish trip') {
	await page.getByRole('button', { name: 'Menu' }).click();
	await page.getByRole('navigation', { name: 'Menu' }).getByText(entry, { exact: true }).click();
}

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
	await addBy(page, 'Add by hand');
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

test('finishing a trip checks the receipt and starts afresh', async ({ page }) => {
	await startTripAtNewStore(page, 'Asda');
	await menu(page, 'Finish trip');
	await expect(page.getByRole('status')).toContainText('Add an item before finishing');

	await addItem(page, 'Milk 2L', '1.45', 2);
	await addItem(page, 'Bread', '0.99');
	await menu(page, 'Finish trip');
	const finish = page.getByRole('dialog', { name: 'Finish trip' });
	await expect(finish).toContainText('£3.89');
	await expect(finish).toContainText('Add the receipt total');

	const receipt = finish.getByLabel('Receipt total (£)');
	await receipt.fill('3.90');
	await expect(finish).toContainText('The till charged £0.01 more than Trolay added up.');
	await receipt.fill('3.8');
	await expect(finish).toContainText('The till charged £0.09 less than Trolay added up.');
	await receipt.fill('abc');
	await expect(finish).toContainText('Enter the total like 42.50.');
	await expect(finish.getByRole('button', { name: 'Finish trip' })).toBeDisabled();
	await receipt.fill('3.89');
	await expect(finish).toContainText('✓ The receipt matches.');

	// The receipt total is kept if the sheet is closed before finishing.
	await receipt.press('Tab');
	await finish.getByRole('button', { name: 'Close' }).click();
	await menu(page, 'Finish trip');
	await expect(finish.getByLabel('Receipt total (£)')).toHaveValue('3.89');

	await finish.getByRole('button', { name: 'Finish trip' }).click();
	await expect(page.getByRole('status')).toHaveText('Trip saved. See it in History');
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();

	// History lists it; the trip opens read-only with its items and the receipt check.
	await page.getByRole('link', { name: 'See it in History' }).click();
	const trips = page.getByRole('list', { name: 'Past trips' });
	await expect(trips.getByRole('link')).toHaveCount(1);
	await expect(trips.getByRole('link')).toContainText('Asda');
	await expect(trips.getByRole('link')).toContainText('£3.89');
	await expect(trips.getByRole('link')).toContainText('3 items');
	await expect(trips.getByRole('link')).toContainText('✓ Receipt matched');
	await trips.getByRole('link').click();
	await expect(page.getByRole('heading', { name: 'Asda' })).toBeVisible();
	await expect(page.getByLabel('Trip totals')).toContainText('£3.89');
	await expect(page.getByLabel('Trip totals')).toContainText('£3.25');
	await expect(page.getByLabel('Trip totals')).toContainText('£0.64');
	await expect(page.getByText('✓ The receipt matched.')).toBeVisible();
	const items = page.getByRole('list', { name: 'Items bought' }).getByRole('listitem');
	await expect(items).toHaveCount(2);
	await expect(items.filter({ hasText: 'Milk 2L' })).toContainText('2 × £1.45 incl. VAT');
	await expect(items.filter({ hasText: 'Milk 2L' })).toContainText('£2.90');
	await expect(page.getByRole('button', { name: /Decrease|Delete/ })).toHaveCount(0);

	// A new trip starts empty.
	await page.getByRole('link', { name: '← History' }).click();
	await page.getByRole('link', { name: '← Trolley' }).click();
	await page.getByRole('button', { name: /^Asda/ }).click();
	await expect(page.getByText('Your trolley is empty.')).toBeVisible();
});

test('history is empty before the first trip is finished', async ({ page }) => {
	await page.goto('/history');
	await expect(page.getByText('No finished trips yet.')).toBeVisible();
	await page.goto('/history/not-a-trip');
	await expect(page.getByText("This trip isn't in your history.")).toBeVisible();
});

async function finishTrip(page: Page, receipt?: string) {
	await menu(page, 'Finish trip');
	const finish = page.getByRole('dialog', { name: 'Finish trip' });
	if (receipt) await finish.getByLabel('Receipt total (£)').fill(receipt);
	await finish.getByRole('button', { name: 'Finish trip' }).click();
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
}

async function downloaded(page: Page, click: () => Promise<void>) {
	const [download] = await Promise.all([page.waitForEvent('download'), click()]);
	const stream = await download.createReadStream();
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(chunk as Buffer);
	return { name: download.suggestedFilename(), bytes: Buffer.concat(chunks) };
}

test('exports one trip or all history as CSV for spreadsheets', async ({ page }) => {
	await startTripAtNewStore(page, 'Tesco');
	await addItem(page, 'Pâté, "smooth"', '2.50');
	await finishTrip(page);
	await page.getByRole('button', { name: /^Tesco/ }).click();
	await addItem(page, 'Milk 2L', '1.45', 2);
	await finishTrip(page);

	await page.goto('/history');
	const all = await downloaded(page, () =>
		page.getByRole('button', { name: 'Export all history as CSV' }).click()
	);
	expect(all.name).toMatch(/^trolay-history-\d{4}-\d{2}-\d{2}\.csv$/);
	// UTF-8 with a byte order mark, so Excel shows "£" and "â" intact.
	expect([...all.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
	const rows = all.bytes.subarray(3).toString('utf8').split('\r\n');
	expect(rows[0]).toBe(
		'Date,Store,Description,Barcode,Quantity,Unit price (£),Unit price includes VAT,Line total incl. VAT (£),Line total excl. VAT (£),VAT (£)'
	);
	// Oldest trip first.
	expect(rows[1]).toMatch(
		/^\d{4}-\d{2}-\d{2} \d{2}:\d{2},Tesco,"Pâté, ""smooth""",,1,2\.50,Yes,2\.50,2\.08,0\.42$/
	);
	expect(rows[2]).toMatch(/,Tesco,Milk 2L,,2,1\.45,Yes,2\.90,2\.42,0\.48$/);
	expect(rows).toHaveLength(4);

	await page.getByRole('link', { name: /Tesco/ }).first().click();
	const one = await downloaded(page, () =>
		page.getByRole('button', { name: 'Export as CSV' }).click()
	);
	expect(one.name).toMatch(/^trolay-tesco-\d{4}-\d{2}-\d{2}\.csv$/);
	const lines = one.bytes.toString('utf8').split('\r\n');
	expect(lines).toHaveLength(3);
	expect(lines[1]).toContain(',Milk 2L,');
});

test('a backup restores everything on a new phone', async ({ page, browser }) => {
	await startTripAtNewStore(page, 'Lidl');
	await addItem(page, 'Pâté, "smooth"', '2.50');
	await finishTrip(page, '2.50');
	await page.getByRole('button', { name: /^Lidl/ }).click();
	await addItem(page, 'Eggs', '2.10');

	await page.goto('/history');
	const backup = await downloaded(page, () =>
		page.getByRole('button', { name: 'Download backup' }).click()
	);
	expect(backup.name).toMatch(/^trolay-backup-\d{4}-\d{2}-\d{2}\.json$/);

	// A fresh browser profile stands in for the new phone.
	const phone = await browser.newContext();
	const fresh = await phone.newPage();
	await fresh.goto('/history');
	await expect(fresh.getByText('No finished trips yet.')).toBeVisible();

	// Something that is not a backup is refused, and nothing changes.
	await fresh
		.getByRole('region', { name: 'Backup' })
		.locator('input[type=file]')
		.setInputFiles({
			name: 'notes.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{"a":1}')
		});
	await expect(fresh.getByRole('alert')).toHaveText('This is not a Trolay backup.');

	await fresh
		.getByRole('region', { name: 'Backup' })
		.locator('input[type=file]')
		.setInputFiles({ name: backup.name, mimeType: 'application/json', buffer: backup.bytes });
	const confirm = fresh.getByRole('dialog', { name: 'Restore this backup?' });
	await expect(confirm).toContainText('has 1 store, 2 trips and 2 items');
	await confirm.getByRole('button', { name: 'Replace with the backup' }).click();
	await expect(fresh.getByRole('status')).toHaveText('Backup restored.');

	const trips = fresh.getByRole('list', { name: 'Past trips' });
	await expect(trips.getByRole('link')).toHaveCount(1);
	await expect(trips.getByRole('link')).toContainText('✓ Receipt matched');
	await trips.getByRole('link').click();
	await expect(fresh.getByRole('list', { name: 'Items bought' })).toContainText('Pâté, "smooth"');

	// The open trip came across too.
	await fresh.goto('/');
	await expect(fresh.getByRole('button', { name: 'Store: Lidl' })).toBeVisible();
	await expect(fresh.getByRole('button', { name: /^Eggs £/ })).toBeVisible();
	await phone.close();
});

test('history can be opened in the middle of a trip, and leads back to it', async ({ page }) => {
	await startTripAtNewStore(page, 'Aldi');
	await addItem(page, 'Bananas', '0.82');
	await finishTrip(page);
	await page.getByRole('button', { name: /^Aldi/ }).click();
	await addItem(page, 'Eggs', '2.10');

	await menu(page, 'History');
	const trips = page.getByRole('list', { name: 'Past trips' });
	await expect(trips.getByRole('link')).toHaveCount(1);
	await expect(trips.getByRole('link')).toContainText('£0.82');

	// Back to the trolley, with the open trip as it was.
	await page.getByRole('link', { name: '← Trolley' }).click();
	await expect(page.getByRole('button', { name: 'Store: Aldi' })).toBeVisible();
	await expect(page.getByRole('button', { name: /^Eggs £/ })).toBeVisible();
});

test('the header shows the store and branch; the menu and the plus open and close', async ({
	page
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Sainsbury’s');
	await page.getByLabel(/Branch or location/).fill('Watford');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();

	const store = page.getByRole('button', { name: 'Store: Sainsbury’s' });
	await expect(store.locator('.name')).toHaveText('Sainsbury’s');
	await expect(store.locator('.branch')).toHaveText('Watford');

	const nav = page.getByRole('navigation', { name: 'Menu' });
	await expect(nav).toBeHidden();
	await page.getByRole('button', { name: 'Menu' }).click();
	await expect(nav.getByRole('link', { name: 'Stores' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(nav).toBeHidden();

	// The plus offers both ways to add an item.
	const add = page.getByRole('group', { name: 'Add an item' });
	await page.getByRole('button', { name: 'Add an item' }).click();
	await expect(add.getByRole('button', { name: 'Snap label' })).toBeVisible();
	await expect(add.getByRole('button', { name: 'Add by hand' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(add).toBeHidden();

	await menu(page, 'Stores');
	await expect(page.getByRole('heading', { name: 'Stores' })).toBeVisible();
});
