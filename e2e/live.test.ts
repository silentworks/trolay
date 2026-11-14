import { expect, test, type Page } from '@playwright/test';
import { addItem, inviteLink, joinedPartner, ownerWithTrip } from './shared';

// The phones sync on their own only once a minute, so an item that shows up on the other phone
// within a couple of seconds got there through the live connection.
const LIVE = { timeout: 2000 };

/**
 * Waits for the phone's live connection to be open, so the two-second clock starts with both
 * phones listening. A phone whose first try came before the trip reached the server waits a
 * growing pause before trying again, hence the long timeout.
 */
async function listening(page: Page) {
	await expect(page.locator('html[data-live="open"]')).toBeAttached({ timeout: 20_000 });
}

test('a change on one phone appears on the other within two seconds, and back', async ({
	browser
}) => {
	const owner = await ownerWithTrip(browser);
	const partner = await joinedPartner(browser, await inviteLink(owner));
	await expect(partner.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();

	await listening(owner);
	await listening(partner);
	await addItem(partner, 'Bread', '0.95');
	await expect(owner.getByText('Bread', { exact: true })).toBeVisible(LIVE);

	// Put the "partner added" toast away first: it would sit over the Add item sheet's Add to cart
	// button, and Playwright's pointer resting on it keeps it from going.
	const told = owner.getByRole('group', { name: 'Message' });
	await expect(told).toContainText('Your partner added Bread');
	await told.getByRole('button', { name: 'Dismiss' }).click();
	await expect(told).toBeHidden();

	await addItem(owner, 'Milk', '1.45');
	await expect(partner.getByText('Milk', { exact: true })).toBeVisible(LIVE);
});

test('a phone that lost its connection catches up when it is back', async ({ browser }) => {
	const owner = await ownerWithTrip(browser);
	const partner = await joinedPartner(browser, await inviteLink(owner));
	await expect(partner.getByRole('button', { name: 'Store: Tesco' })).toBeVisible();
	await listening(owner);
	await listening(partner);

	await partner.context().setOffline(true);
	await addItem(owner, 'Eggs', '2.10');
	await expect(partner.getByText('Eggs', { exact: true })).toHaveCount(0);

	await partner.context().setOffline(false);
	// It reconnects (after its pause) and syncs, without anyone touching it.
	await expect(partner.getByText('Eggs', { exact: true })).toBeVisible({ timeout: 15_000 });
});
