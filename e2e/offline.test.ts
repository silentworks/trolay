import { expect, test } from '@playwright/test';
import { ownerWithTrip } from './shared';

const toast = (page: import('@playwright/test').Page) =>
	page.getByRole('group', { name: 'Message' }).getByRole('status');

test('the header shows an offline icon beside the title, which says what still works', async ({
	page,
	context
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Co-op');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	const title = page.getByRole('button', { name: 'Store: Co-op' });
	await expect(title).toBeVisible();
	const offline = page.getByRole('banner').getByRole('button', { name: 'Offline' });
	await expect(offline).toHaveCount(0);
	const before = await title.boundingBox();

	await context.setOffline(true);
	await expect(offline).toBeVisible();
	// Right of the title, and the title stays where it was.
	expect((await offline.boundingBox())!.x).toBeGreaterThan(before!.x);
	expect(await title.boundingBox()).toEqual(before);
	await expect(page.locator('header [aria-live]')).toHaveText("You're offline.");

	// Signed out, there is nothing to sync, so it doesn't promise that.
	await offline.click();
	await expect(toast(page)).toHaveText("You're offline. Trolay keeps working on this phone.");

	await context.setOffline(false);
	await expect(offline).toHaveCount(0);
	await expect(page.locator('header [aria-live]')).toHaveText('Back online.');
});

test('a centred title stays put when the offline icon appears', async ({ page, context }) => {
	await page.goto('/settings');
	const title = page.getByRole('heading', { name: 'Settings', level: 1 });
	const before = await title.boundingBox();
	await context.setOffline(true);
	await expect(page.getByRole('button', { name: 'Offline' })).toBeVisible();
	expect(await title.boundingBox()).toEqual(before);
	await context.setOffline(false);
	await expect(page.getByRole('button', { name: 'Offline' })).toHaveCount(0);
});

test('signed in, the offline icon takes the sync icon’s place until the signal is back', async ({
	browser
}) => {
	const owner = await ownerWithTrip(browser);
	const header = owner.getByRole('banner');
	const sync = header.getByRole('link', { name: 'Sync details' });
	const offline = header.getByRole('button', { name: 'Offline' });

	await owner.context().setOffline(true);
	await expect(offline).toBeVisible();
	await expect(sync).toBeHidden();
	// Its own sync message is read out, so the header doesn't say it twice.
	await expect(owner.locator('header [aria-live]')).toHaveText('');
	await offline.click();
	await expect(toast(owner)).toHaveText(
		"You're offline. Trolay keeps working, and changes sync when you're back online."
	);

	await owner.context().setOffline(false);
	await expect(offline).toHaveCount(0);
});
