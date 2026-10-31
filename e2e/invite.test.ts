import { expect, test } from '@playwright/test';
import { addItem, inviteLink, menu, newPhone, ownerWithTrip, signUp, synced } from './shared';

test('an owner invites a partner by link, who signs in and joins; a second partner is refused', async ({
	browser
}) => {
	const owner = await ownerWithTrip(browser);
	const invite = await inviteLink(owner);

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

	// The trip, its store and its items are on the partner's phone, and they can add to it.
	await partner.getByRole('link', { name: 'Go to the trip' }).click();
	await expect(partner.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();
	await addItem(partner, 'Bread', '0.95');
	// Each phone syncs on the Account page; the owner looks until Bread has come across.
	await partner.goto('/account');
	await expect(synced(partner)).toBeVisible();
	await expect(async () => {
		await owner.goto('/account');
		await expect(synced(owner)).toBeVisible();
		await owner.goto('/');
		await expect(owner.getByText('Bread')).toBeVisible({ timeout: 2000 });
	}).toPass({ timeout: 20_000 });

	// The link is used up, and the trip is full.
	const third = await newPhone(browser);
	await signUp(third);
	await third.goto(invite);
	await third.getByRole('button', { name: 'Join the trip' }).click();
	await expect(third.getByRole('alert')).toContainText('expired or was already used');
	// With a partner on the trip the owner is no longer offered another invite.
	await owner.getByRole('button', { name: 'Menu' }).click();
	const nav = owner.getByRole('navigation', { name: 'Menu' });
	await expect(nav.getByText('Remove partner')).toBeVisible({ timeout: 15_000 });
	await expect(nav.getByText('Invite a partner')).toHaveCount(0);
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

test('a trip started under another account on this phone says why it cannot be shared', async ({
	browser
}) => {
	// The first account makes the trip and syncs it.
	const phone = await ownerWithTrip(browser);
	await addItem(phone, 'Milk', '1.45');
	await expect(async () => {
		await phone.goto('/account');
		await expect(synced(phone)).toBeVisible();
	}).toPass();

	// Then a different account signs in on the same phone. The first account's trip stays on the
	// phone, but the server will not give it to someone else, so it can never be shared from here.
	await phone.getByRole('button', { name: 'Sign out' }).click();
	await phone.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(phone.getByText("You're signed in on this device.")).toBeVisible();
	await expect(synced(phone)).toBeVisible();
	await phone.goto('/');
	await expect(phone.getByText('Milk')).toBeVisible();

	await menu(phone, 'Invite a partner');
	await expect(
		phone.getByRole('dialog', { name: 'Invite a partner' }).getByRole('alert')
	).toContainText('different account on this phone', { timeout: 15_000 });
	await expect(phone.getByRole('alert')).not.toContainText('connection');
});
