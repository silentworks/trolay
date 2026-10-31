import { expect, test } from '@playwright/test';
import { addItem, inviteLink, joinedPartner, ownerWithTrip } from './shared';

// The phones sync on their own only once a minute, so an item that shows up on the other phone
// within a couple of seconds got there through the live connection.
const LIVE = { timeout: 2000 };

test('a change on one phone appears on the other within two seconds, and back', async ({
	browser
}) => {
	const owner = await ownerWithTrip(browser);
	const partner = await joinedPartner(browser, await inviteLink(owner));
	await expect(partner.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();

	// Both phones are now on the trip. Give each a moment to open its connection.
	await partner.waitForTimeout(1000);
	await addItem(partner, 'Bread', '0.95');
	await expect(owner.getByText('Bread')).toBeVisible(LIVE);

	await addItem(owner, 'Milk', '1.45');
	await expect(partner.getByText('Milk')).toBeVisible(LIVE);
});

test('a phone that lost its connection catches up when it is back', async ({ browser }) => {
	const owner = await ownerWithTrip(browser);
	const partner = await joinedPartner(browser, await inviteLink(owner));
	await partner.waitForTimeout(1000);

	await partner.context().setOffline(true);
	await addItem(owner, 'Eggs', '2.10');
	await expect(partner.getByText('Eggs')).toHaveCount(0);

	await partner.context().setOffline(false);
	// It reconnects (after its pause) and syncs, without anyone touching it.
	await expect(partner.getByText('Eggs')).toBeVisible({ timeout: 15_000 });
});
