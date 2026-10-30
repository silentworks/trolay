import { expect, test, type Page } from '@playwright/test';

// A virtual authenticator stands in for the phone's passkey store (Chromium only).
async function withPasskeys(page: Page) {
	const client = await page.context().newCDPSession(page);
	await client.send('WebAuthn.enable');
	await client.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			automaticPresenceSimulation: true
		}
	});
}

test('create an account with a passkey, stay signed in, sign out, sign in again', async ({
	page
}) => {
	await withPasskeys(page);
	await page.goto('/account');
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();

	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByRole('status')).toHaveText("You're signed in on this device.");

	// The session is a cookie, so it survives a reload.
	await page.reload();
	await expect(page.getByRole('status')).toHaveText("You're signed in on this device.");

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();

	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page.getByRole('status')).toHaveText("You're signed in on this device.");
});

test('the app keeps working without an account', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
	await page.getByRole('button', { name: 'Menu' }).click();
	await page.getByRole('navigation', { name: 'Menu' }).getByText('Account').click();
	await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
	await expect(page.getByText("you don't need an account")).toBeVisible();
	await page.getByRole('link', { name: 'Back to Trolley' }).click();
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
});

test('cancelling the passkey prompt says so and signs nobody in', async ({ page }) => {
	// No authenticator is available, so the browser refuses the request.
	await page.goto('/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
});
