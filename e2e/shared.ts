import { expect, type Browser, type Page } from '@playwright/test';
import { withPasskeys } from './passkeys';

export const BASE = 'http://localhost:4173';
export const synced = (page: Page) => page.getByRole('status').filter({ hasText: '✓ Synced' });

/** A phone with its own passkey store and nothing on it. */
export async function newPhone(browser: Browser) {
	const page = await (await browser.newContext({ baseURL: BASE })).newPage();
	await withPasskeys(page);
	return page;
}

/** Makes an account on the phone with a passkey. */
export async function signUp(page: Page) {
	await page.goto('/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(synced(page)).toBeVisible();
}

/** A phone with a store and an open trip, signed in. */
export async function ownerWithTrip(browser: Browser, store = 'Tesco', branch = 'Watford') {
	const owner = await newPhone(browser);
	await owner.goto('/');
	await owner.getByRole('button', { name: 'Add a new store' }).click();
	await owner.getByLabel('Store name').fill(store);
	await owner.getByLabel(/Branch or location/).fill(branch);
	await owner.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(owner.getByRole('button', { name: `Store: ${store}` })).toBeVisible();
	await signUp(owner);
	await owner.goto('/');
	return owner;
}

/**
 * Picks an entry from the ⋮ menu. A "new version is ready" banner can sit over the menu button
 * (the service worker finds an update now and then), so it is put off first if it is there.
 */
export async function menu(page: Page, entry: string) {
	const later = page.getByRole('complementary', { name: 'App update' }).getByRole('button', {
		name: 'Later'
	});
	if (await later.isVisible()) await later.click();
	await page.getByRole('button', { name: 'Menu' }).click();
	await page.getByRole('navigation', { name: 'Menu' }).getByText(entry, { exact: true }).click();
}

/** The invite link for the trip open on this phone. */
export async function inviteLink(owner: Page): Promise<string> {
	await menu(owner, 'Invite a partner');
	const sheet = owner.getByRole('dialog', { name: 'Invite a partner' });
	const link = sheet.getByLabel('Invite link');
	await expect(link).toHaveValue(/\/join#token=/);
	const url = await link.inputValue();
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toBeHidden();
	return url;
}

/** A new phone and account that has joined the trip by the invite link. */
export async function joinedPartner(browser: Browser, invite: string) {
	const partner = await newPhone(browser);
	await partner.goto(invite);
	await partner.getByRole('link', { name: 'Sign in' }).click();
	await partner.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await partner.getByRole('link', { name: 'Continue joining the trip' }).click();
	await partner.getByRole('button', { name: 'Join the trip' }).click();
	await expect(partner.getByRole('status')).toContainText("You've joined the trip");
	await partner.getByRole('link', { name: 'Go to the trip' }).click();
	return partner;
}

export async function addItem(page: Page, description: string, price: string) {
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByLabel('Description').fill(description);
	await sheet.getByLabel('Unit price (£)').fill(price);
	await sheet.getByRole('button', { name: 'Add to cart' }).click();
	await expect(sheet).toBeHidden();
}
