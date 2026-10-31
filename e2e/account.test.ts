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

test('a passkey from an authenticator that never verifies the user can make an account', async ({
	page
}) => {
	// Signing in again is covered by the Worker tests: Chromium's virtual authenticator will not
	// answer a discoverable-credential request when it cannot verify the user.
	await withPasskeys(page, { verifiesUser: false });
	await page.goto('/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
	await page.reload();
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

/** The six-digit code in the latest email to this address (the dev API captures emails). */
async function emailedCode(page: Page, to: string): Promise<string> {
	let code = '';
	await expect(async () => {
		const reply = await page.request.get(`/api/dev/outbox?to=${encodeURIComponent(to)}`);
		const { mail } = await reply.json();
		const found = mail.at(-1)?.text.match(/\b(\d{3}) (\d{3})\b/);
		code = found ? found[1] + found[2] : '';
		expect(code).toMatch(/^\d{6}$/);
	}).toPass();
	return code;
}

test('sign in with an emailed code; a wrong one is refused; then add a passkey', async ({
	page
}) => {
	await withPasskeys(page);
	const email = `shopper-${Date.now()}@example.com`;
	await page.goto('/account');
	await page.getByLabel('No passkey on this device? Sign in by email').fill(email);
	await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
	await expect(page.getByRole('status')).toContainText('Check your email');
	await expect(page.getByLabel(/Enter the 6-digit code sent to/)).toBeVisible();

	const code = await emailedCode(page, email);
	// A wrong code is refused, and says so.
	const box = page.getByLabel(/Enter the 6-digit code sent to/);
	await box.fill(code === '000000' ? '111111' : '000000');
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText("isn't right");

	await box.fill(`${code.slice(0, 3)} ${code.slice(3)}`);
	await page.getByRole('button', { name: 'Sign in', exact: true }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();

	// Signed in by email, so a passkey is offered; adding one works, and then it signs in.
	await expect(
		page.getByText('Add a passkey on this device, and you can sign in here')
	).toBeVisible();
	await page.getByRole('button', { name: 'Add a passkey on this device' }).click();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await page.getByRole('button', { name: 'Sign out' }).click();
	await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
});

test('a signed-in account adds an email with a code, and can start over with another address', async ({
	page
}) => {
	await withPasskeys(page);
	await page.goto('/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();

	const wrong = `typo-${Date.now()}@example.com`;
	await page.getByLabel('Add an email address, so you can sign in without a passkey').fill(wrong);
	await page.getByRole('button', { name: 'Email me a code to confirm it' }).click();
	await page.getByRole('button', { name: 'Use a different email' }).click();

	const email = `added-${Date.now()}@example.com`;
	await page.getByLabel('Add an email address, so you can sign in without a passkey').fill(email);
	await page.getByRole('button', { name: 'Email me a code to confirm it' }).click();
	const code = await emailedCode(page, email);
	await page.getByLabel(/Enter the 6-digit code sent to/).fill(code);
	await page.getByRole('button', { name: 'Confirm email' }).click();
	await expect(page.getByText(`${email} is now on your account.`)).toBeVisible();
});
