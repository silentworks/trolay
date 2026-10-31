import { expect, test } from '@playwright/test';
import { addItem, inviteLink, joinedPartner, ownerWithTrip } from './shared';

test('a shared trip says who added each item, and one that is not shared says nothing', async ({
	browser
}) => {
	const owner = await ownerWithTrip(browser);
	await addItem(owner, 'Milk', '1.45');
	await expect(owner.getByText('Milk')).toBeVisible();
	// Not shared yet: nothing extra on the row.
	await expect(owner.getByText(/Added by/)).toHaveCount(0);

	const partner = await joinedPartner(browser, await inviteLink(owner));
	await addItem(partner, 'Bread', '0.95');

	// Each phone sees its own items as "you" and the other's by what that person is called (a
	// passkey-only account has no name, so by their part in the trip).
	const row = (page: typeof owner, name: string) =>
		page.getByRole('listitem').filter({ hasText: name });
	await expect(row(partner, 'Bread')).toContainText('Added by you', { timeout: 15_000 });
	await expect(row(partner, 'Milk')).toContainText('Added by the trip owner', { timeout: 15_000 });
	await expect(row(owner, 'Milk')).toContainText('Added by you', { timeout: 15_000 });
	await expect(row(owner, 'Bread')).toContainText('Added by your partner', { timeout: 15_000 });
});
