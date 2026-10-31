import { expect, test } from '@playwright/test';
import { addItem, inviteLink, joinedPartner, menu, ownerWithTrip, synced } from './shared';

test('a partner leaves the trip; it stays with the owner, who can invite again', async ({
	browser
}) => {
	const owner = await ownerWithTrip(browser);
	await addItem(owner, 'Milk', '1.45');
	const partner = await joinedPartner(browser, await inviteLink(owner));
	await addItem(partner, 'Bread', '0.95');
	await expect(owner.getByText('Bread')).toBeVisible({ timeout: 15_000 });
	// Shared: the owner's menu offers to remove the partner, not to invite one.
	await owner.getByRole('button', { name: 'Menu' }).click();
	await expect(
		owner.getByRole('navigation', { name: 'Menu' }).getByText('Remove partner')
	).toBeVisible({ timeout: 15_000 });
	await owner.keyboard.press('Escape');

	await menu(partner, 'Leave this trip');
	await partner
		.getByRole('dialog', { name: 'Leave this trip?' })
		.getByRole('button', {
			name: 'Leave the trip'
		})
		.click();
	await expect(partner.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
	await expect(partner.getByText('You left the trip at Tesco')).toBeVisible();

	// The owner still has the trip and what the partner added, and is back to being alone on it.
	await expect(owner.getByText('Bread')).toBeVisible();
	await expect(async () => {
		await owner.getByRole('button', { name: 'Menu' }).click();
		await expect(
			owner.getByRole('navigation', { name: 'Menu' }).getByText('Invite a partner')
		).toBeVisible({ timeout: 1500 });
	}).toPass({ timeout: 20_000 });
});

test('an owner removes the partner, whose phone lets go of the trip', async ({ browser }) => {
	const owner = await ownerWithTrip(browser);
	await addItem(owner, 'Milk', '1.45');
	const partner = await joinedPartner(browser, await inviteLink(owner));
	await expect(partner.getByText('Milk')).toBeVisible();
	await partner.waitForTimeout(1000);
	await expect(async () => {
		await menu(owner, 'Remove partner');
	}).toPass({ timeout: 20_000 });
	await owner
		.getByRole('dialog', { name: 'Remove your partner?' })
		.getByRole('button', {
			name: 'Remove partner'
		})
		.click();
	await expect(owner.getByRole('status')).toContainText('Your partner is off the trip');

	// The partner's phone is told, and says so.
	await expect(partner.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible({
		timeout: 15_000
	});
	await expect(partner.getByText('You are no longer on the trip at Tesco')).toBeVisible();
	// Their stores no longer include the owner's.
	await partner.goto('/stores');
	await expect(partner.getByText('Tesco')).toHaveCount(0);
});

test('a trip finished while shared stays in both histories', async ({ browser }) => {
	const owner = await ownerWithTrip(browser);
	await addItem(owner, 'Milk', '1.45');
	const partner = await joinedPartner(browser, await inviteLink(owner));
	await expect(partner.getByText('Milk')).toBeVisible();

	await menu(owner, 'Finish trip');
	const finish = owner.getByRole('dialog', { name: 'Finish trip' });
	await finish.getByLabel('Receipt total (£)').fill('1.45');
	await finish.getByRole('button', { name: 'Finish trip' }).click();
	await expect(owner.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();

	for (const phone of [owner, partner]) {
		await expect(async () => {
			await phone.goto('/account');
			await expect(synced(phone)).toBeVisible();
			await phone.goto('/history');
			await expect(phone.getByRole('link', { name: /Tesco/ })).toBeVisible({ timeout: 1500 });
		}).toPass({ timeout: 20_000 });
	}
});
