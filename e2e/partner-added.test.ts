import { expect, test } from '@playwright/test';
import { addItem, inviteLink, joinedPartner, ownerWithTrip } from './shared';

const toastOf = (page: import('@playwright/test').Page) =>
	page.getByRole('group', { name: 'Message' });

test('an item the partner adds is told on the other phone, and Show goes to it', async ({
	browser
}) => {
	const owner = await ownerWithTrip(browser);
	await addItem(owner, 'Milk', '1.45');

	// Joining brings everything at once: nothing to tell.
	const partner = await joinedPartner(browser, await inviteLink(owner));
	await expect(partner.getByText('Milk', { exact: true })).toBeVisible({ timeout: 15_000 });
	await expect(toastOf(partner).getByText(/added/)).toHaveCount(0);

	// Away from the trolley, the owner is told all the same.
	await owner.goto('/history');
	await addItem(partner, 'Bread', '0.95');
	await expect(toastOf(owner).getByRole('status')).toHaveText('Your partner added Bread', {
		timeout: 15_000
	});
	// The phone that added it is not told.
	await expect(toastOf(partner).getByText(/added/)).toHaveCount(0);

	await toastOf(owner).getByRole('button', { name: 'Show' }).click();
	const bread = owner.getByRole('listitem').filter({ hasText: 'Bread' });
	await expect(bread.getByRole('button', { name: /^Bread/ })).toBeFocused();
	await expect(bread).toBeInViewport();
});
