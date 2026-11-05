import { expect, test, type Page } from '@playwright/test';
import { menu, ownerWithTrip } from './shared';

// A phone's width.
test.use({ viewport: { width: 360, height: 740 } });

async function startTrip(page: Page) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(page.getByRole('region', { name: 'Trolley total' })).toBeVisible();
}

async function addItem(page: Page, description: string) {
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByLabel('Description').fill(description);
	await sheet.getByLabel('Unit price').fill('1.10');
	await sheet.getByRole('button', { name: 'Add to cart' }).click();
	await expect(sheet).toBeHidden();
}

const toastOf = (page: Page) => page.getByRole('group', { name: 'Message' });

test('a toast sits above the totals and goes away by itself', async ({ page }) => {
	await startTrip(page);
	await addItem(page, 'Bread');
	await page.getByRole('button', { name: 'Delete Bread' }).click();
	const toast = toastOf(page);
	await expect(toast.getByRole('status')).toHaveText('Deleted Bread');
	await expect(toast.getByRole('button', { name: 'Undo' })).toBeVisible();

	// Above the dock, not over it, and inside the screen.
	const card = (await toast.boundingBox())!;
	const total = (await page.getByRole('region', { name: 'Trolley total' }).boundingBox())!;
	expect(card.y + card.height).toBeLessThanOrEqual(total.y);
	expect(card.x).toBeGreaterThanOrEqual(16);
	expect(card.x + card.width).toBeLessThanOrEqual(360 - 16);

	await expect(toast).toBeHidden({ timeout: 8000 });
});

test('a toast closes with its ×, and waits while it is held', async ({ page }) => {
	await startTrip(page);
	await addItem(page, 'Bread');
	await page.getByRole('button', { name: 'Delete Bread' }).click();
	const toast = toastOf(page);
	await toast.getByRole('button', { name: 'Dismiss' }).click();
	await expect(toast).toBeHidden();

	// Focus on Undo keeps it past its time; it goes once focus moves on.
	await addItem(page, 'Milk');
	await page.getByRole('button', { name: 'Delete Milk' }).click();
	const undo = toast.getByRole('button', { name: 'Undo' });
	await undo.focus();
	await page.waitForTimeout(6000);
	await expect(undo).toBeVisible();
	await undo.blur();
	await expect(toast).toBeHidden({ timeout: 8000 });
});

test('a new toast replaces the one showing', async ({ page }) => {
	await startTrip(page);
	await addItem(page, 'Bread');
	await addItem(page, 'Milk');
	await page.getByRole('button', { name: 'Delete Bread' }).click();
	await expect(toastOf(page).getByRole('status')).toHaveText('Deleted Bread');
	await page.getByRole('button', { name: 'Store: Tesco' }).click();
	await expect(toastOf(page)).toHaveCount(1);
	await expect(toastOf(page).getByRole('status')).toContainText('only be changed');
	await expect(toastOf(page).getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('copying the invite link says so in a success toast over the sheet', async ({ browser }) => {
	const owner = await ownerWithTrip(browser);
	await owner.context().grantPermissions(['clipboard-read', 'clipboard-write']);
	await menu(owner, 'Invite a partner');
	const sheet = owner.getByRole('dialog', { name: 'Invite a partner' });
	await expect(sheet.getByLabel('Invite link', { exact: true })).toHaveValue(/\/join#token=/);
	await sheet.getByRole('button', { name: 'Copy link' }).click();
	const toast = toastOf(owner);
	await expect(toast.getByRole('status')).toHaveText('Link copied');
	await expect(toast).toHaveAttribute('data-tone', 'success');
	// Tappable while the sheet is open.
	await toast.getByRole('button', { name: 'Dismiss' }).click();
	await expect(toast).toBeHidden();
	await expect(sheet).toBeVisible();
});
