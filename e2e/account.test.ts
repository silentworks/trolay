import { expect, test, type Page } from '@playwright/test';
import { withPasskeys } from './passkeys';

test('create an account with a passkey, stay signed in, sign out, sign in again', async ({
	page
}) => {
	await withPasskeys(page);
	await page.goto('/account');
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();

	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();

	// The session is a cookie, so it survives a reload.
	await page.reload();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();

	await page.getByRole('button', { name: 'Sign out' }).click();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();

	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
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

/** The sign-in link in the latest email to this address (the dev API captures emails). */
async function emailedLink(page: Page, to: string): Promise<string> {
	let link = '';
	await expect(async () => {
		const reply = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(to)}`);
		const { mail } = await reply.json();
		link = mail.at(-1)?.text.match(/https?:\S+/)?.[0] ?? '';
		expect(link).toContain('/account/link#token=');
	}).toPass();
	return link;
}

test('sign in by emailed link, once; then add a passkey on this device', async ({ page }) => {
	await withPasskeys(page);
	const email = `shopper-${Date.now()}@example.com`;
	await page.goto('/account');
	await page.getByLabel('No passkey on this device? Sign in by email').fill(email);
	await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
	await expect(page.getByRole('status')).toContainText('Check your email');

	const link = await emailedLink(page, email);
	await page.goto(link);
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
	// The token is gone from the address bar once the page has read it.
	expect(page.url()).not.toContain('token');

	// Signed in by email, so a passkey is offered; adding one works.
	await page.getByRole('button', { name: 'Add a passkey on this device' }).click();
	await expect(page.getByText('Passkey added.')).toBeVisible();

	// A link works once. (Opened from an email it loads a fresh page, as going elsewhere first does.)
	await page.goto('/account');
	await page.goto(link);
	await expect(page.getByRole('alert')).toContainText('expired or was already used');
});
