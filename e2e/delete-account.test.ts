import { expect, test, type Page } from '@playwright/test';
import { addItem, inviteLink, joinedPartner, ownerWithTrip } from './shared';

/** Opens Delete account in Settings › Account & sync; returns its sheet. */
async function openDelete(page: Page) {
	await page.goto('/settings/account');
	await page.getByRole('button', { name: 'Delete account' }).click();
	return page.getByRole('dialog', { name: 'Delete your account?' });
}

test('deleting the account signs out, takes the partner off the trip, and keeps this phone’s trips', async ({
	browser
}) => {
	const owner = await ownerWithTrip(browser);
	await addItem(owner, 'Milk', '1.45');
	const partner = await joinedPartner(browser, await inviteLink(owner));
	await expect(partner.getByText('Milk', { exact: true })).toBeVisible({ timeout: 15_000 });

	const sheet = await openDelete(owner);
	await expect(sheet.getByRole('switch', { name: 'Trips and stores on this phone' })).toHaveText(
		'Keep'
	);
	await sheet.getByRole('button', { name: 'Delete account' }).click();

	await expect(owner.getByText('Your account is deleted.')).toBeVisible();
	await expect(owner.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();

	// The partner's phone lets go of the trip, as when they are taken off it.
	await expect(partner.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible({
		timeout: 15_000
	});
	await expect(partner.getByText('You are no longer on the trip at Tesco')).toBeVisible();

	// This phone kept its trip, signed out.
	await owner.goto('/');
	await expect(owner.getByText('Milk', { exact: true })).toBeVisible();

	// The passkey no longer signs anyone in.
	await owner.goto('/settings/account');
	await owner.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(owner.getByRole('alert')).toBeVisible();
	await expect(owner.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
});

test('closing the sheet deletes nothing; deleting can remove everything from this phone', async ({
	browser
}) => {
	const owner = await ownerWithTrip(browser);
	await addItem(owner, 'Milk', '1.45');

	let sheet = await openDelete(owner);
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(sheet).toBeHidden();
	await expect(owner.getByText("You're signed in on this device.")).toBeVisible();

	sheet = await openDelete(owner);
	const remove = sheet.getByRole('switch', { name: 'Trips and stores on this phone' });
	await remove.click();
	await expect(remove).toHaveText('Remove');
	await sheet.getByRole('button', { name: 'Delete account' }).click();
	await expect(owner.getByText('Your account is deleted.')).toBeVisible();

	await owner.goto('/');
	await expect(owner.getByText('No stores yet')).toBeVisible();
	await expect(owner.getByText('Milk', { exact: true })).toHaveCount(0);
});
