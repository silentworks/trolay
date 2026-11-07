import { expect, test } from '@playwright/test';
import { withPasskeys } from './passkeys';

test('create an account with a passkey, stay signed in, sign out, sign in again', async ({
	page
}) => {
	await withPasskeys(page);
	await page.goto('/settings/account');
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();

	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();

	// The session is a cookie, so it survives a reload.
	await page.reload();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();

	await page.getByRole('button', { name: 'Sign out', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();

	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
});

test('a passkey from an authenticator that never verifies the user can make an account', async ({
	page
}) => {
	// Signing in again is covered by the Worker tests: Chromium's virtual authenticator will not
	// answer a discoverable-credential request when it cannot verify the user.
	await withPasskeys(page, { verifiesUser: false });
	await page.goto('/settings/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
	await page.reload();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
});

test('the app keeps working without an account', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
	await page.getByRole('button', { name: 'Menu' }).click();
	await page.getByRole('navigation', { name: 'Menu' }).getByText('Settings').click();
	await page.getByRole('link', { name: /^Account & sync/ }).click();
	await expect(page.getByRole('heading', { name: 'Account & sync' })).toBeVisible();
	await expect(page.getByText("you don't need an account")).toBeVisible();
	await page.getByRole('link', { name: 'Back to Settings' }).click();
	await page.getByRole('link', { name: 'Back to Trolley' }).click();
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
});

test('cancelling the passkey prompt says so and signs nobody in', async ({ page }) => {
	// No authenticator is available, so the browser refuses the request.
	await page.goto('/settings/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
});

test('accounts use passkeys only: there is no email sign-in, signed out or in', async ({
	page
}) => {
	await withPasskeys(page);
	await page.goto('/settings/account');
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
	await expect(page.getByRole('textbox')).toHaveCount(0);
	await expect(page.getByText(/email/i)).toHaveCount(0);

	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
	await expect(page.getByRole('textbox')).toHaveCount(0);
	await expect(page.getByText(/email/i)).toHaveCount(0);

	// Nor does the API answer for it.
	for (const path of ['/api/auth/code/request', '/api/auth/code/verify']) {
		const reply = await page.request.post(path, { data: { email: 'someone@example.com' } });
		expect(reply.status()).toBe(404);
	}
	expect((await page.request.get('/api/dev/outbox')).status()).toBe(404);
});

test('signing out on all devices signs this one out too, and the passkey still works', async ({
	page
}) => {
	// That every other session ends as well is checked in the Worker's tests (worker/auth.spec.ts).
	await withPasskeys(page);
	await page.goto('/settings/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
	await page.getByRole('button', { name: 'Sign out on all devices' }).click();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
});
