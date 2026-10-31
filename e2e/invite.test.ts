import { expect, test, type Page } from '@playwright/test';
import { withPasskeys } from './passkeys';

const BASE = 'http://localhost:4173';
const synced = (page: Page) => page.getByRole('status').filter({ hasText: '✓ Synced' });

async function newPhone(browser: import('@playwright/test').Browser) {
	const page = await (await browser.newContext({ baseURL: BASE })).newPage();
	await withPasskeys(page);
	return page;
}

async function signUp(page: Page) {
	await page.goto('/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(synced(page)).toBeVisible();
}

test('an owner invites a partner by link, who signs in and joins; a second partner is refused', async ({
	browser
}) => {
	const owner = await newPhone(browser);
	await owner.goto('/');
	await owner.getByRole('button', { name: 'Add a new store' }).click();
	await owner.getByLabel('Store name').fill('Tesco');
	await owner.getByLabel(/Branch or location/).fill('Watford');
	await owner.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(owner.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();
	await signUp(owner);
	await owner.goto('/');

	await owner.getByRole('button', { name: 'Menu' }).click();
	await owner.getByRole('navigation', { name: 'Menu' }).getByText('Invite a partner').click();
	const sheet = owner.getByRole('dialog', { name: 'Invite a partner' });
	const link = sheet.getByLabel('Invite link');
	await expect(link).toHaveValue(/\/join#token=/);
	const invite = await link.inputValue();

	// Signed out, the partner is asked to sign in, and the invite waits while they do.
	const partner = await newPhone(browser);
	await partner.goto(invite);
	await expect(partner.getByText("You've been invited to share a shopping trip.")).toBeVisible();
	await expect(partner.getByRole('button', { name: 'Join the trip' })).toHaveCount(0);
	await partner.getByRole('link', { name: 'Sign in' }).click();
	await partner.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await partner.getByRole('link', { name: 'Continue joining the trip' }).click();
	await partner.getByRole('button', { name: 'Join the trip' }).click();
	await expect(partner.getByRole('status')).toContainText(
		"You've joined the trip at Tesco, Watford."
	);
	// The token is not left in the address.
	expect(partner.url()).not.toContain('token');

	// The link is used up, and the trip is full.
	const third = await newPhone(browser);
	await signUp(third);
	await third.goto(invite);
	await third.getByRole('button', { name: 'Join the trip' }).click();
	await expect(third.getByRole('alert')).toContainText('expired or was already used');
	await owner.getByRole('button', { name: 'Make a new link' }).click();
	await expect(owner.getByRole('alert')).toContainText('This trip already has a partner.');
});

test('inviting needs an account', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Aldi');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await page.getByRole('button', { name: 'Menu' }).click();
	await page.getByRole('navigation', { name: 'Menu' }).getByText('Invite a partner').click();
	await expect(page.getByRole('status')).toContainText('Sign in on the Account page');
});
