import { expect, test, type Page } from '@playwright/test';

// The form's bot check is Turnstile with its test site key, and the local API checks tokens with
// Turnstile's test secret (scripts/dev-api.js), so every token passes. Its email binding keeps
// what it is given and sends nothing.

/**
 * Each test sends from an address of its own, as the API sees it, so the hourly limit per
 * source isn't shared by every run against one API.
 */
async function ownSource(page: Page) {
	const ip = `198.18.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
	await page.route('**/api/feedback', (route) =>
		route.continue({ headers: { ...route.request().headers(), 'cf-connecting-ip': ip } })
	);
}

const send = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });

/**
 * Presses Send. The form is taller than the screen, and just after a scroll Chromium's phone
 * emulation can hit-test a tap against where things were, sending it into the bot check's frame
 * above Send. So Send is scrolled to first, and the page given a frame to settle.
 */
async function pressSend(page: Page) {
	await send(page).scrollIntoViewIfNeeded();
	await page.evaluate(
		() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
	);
	await send(page).click();
}

async function openForm(page: Page) {
	await page.goto('/settings');
	await page.getByRole('link', { name: 'Send feedback' }).click();
	await expect(page.getByRole('heading', { name: 'Send feedback', level: 1 })).toBeVisible();
}

test('feedback is sent once the bot check passes, and the draft is cleared', async ({ page }) => {
	await ownSource(page);
	await openForm(page);
	await page.getByRole('radio', { name: 'Problem' }).check();
	await page
		.getByRole('textbox', { name: 'Message' })
		.fill('The total was wrong after a discount.');
	await page.getByLabel('Your email').fill('shopper@example.com');

	// What's sent is shown, and nothing of the trips.
	await page.getByText('What’s sent').click();
	await expect(page.getByText('Browser and system')).toBeVisible();
	await expect(page.getByText('Your trips, items and stores are never sent.')).toBeVisible();

	// The draft survives a reload.
	await page.reload();
	await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
		'The total was wrong after a discount.'
	);
	await expect(page.getByRole('radio', { name: 'Problem' })).toBeChecked();

	// Send waits for Turnstile's token.
	await expect(send(page)).toBeEnabled({ timeout: 20_000 });
	const request = page.waitForRequest('**/api/feedback');
	await pressSend(page);
	const body = (await request).postDataJSON();
	expect(body).toMatchObject({
		topic: 'Problem',
		message: 'The total was wrong after a discount.',
		email: 'shopper@example.com',
		details: { installed: 'No', signedIn: 'No', theme: 'Light' }
	});

	await expect(page.getByText('Thanks, your feedback was sent')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
	await page.getByRole('link', { name: 'Send feedback' }).click();
	await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue('');
});

test('a message the server refuses shows why, and keeps what was typed', async ({ page }) => {
	await openForm(page);
	await page.getByRole('textbox', { name: 'Message' }).fill('Short');
	await page.getByLabel('Your email').fill('not an address');
	await expect(send(page)).toBeEnabled({ timeout: 20_000 });
	await pressSend(page);
	// Checked here first: nothing is sent.
	await expect(page.getByText('Write at least 10 characters.')).toBeVisible();
	await expect(page.getByText('That doesn’t look like an email address.')).toBeVisible();

	// The server checks too: a reply address it won't take is refused, and said so.
	await page
		.getByRole('textbox', { name: 'Message' })
		.fill('Please add a dark mode for the receipt view.');
	await page.getByLabel('Your email').fill('shopper@example.com');
	await page.route('**/api/feedback', (route) => {
		const body = { ...route.request().postDataJSON(), email: 'two@a.test, b@c.test' };
		return route.continue({ postData: JSON.stringify(body) });
	});
	await pressSend(page);
	await expect(page.getByRole('alert')).toHaveText('That doesn’t look like an email address.');
	await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
		'Please add a dark mode for the receipt view.'
	);
	// A fresh check is asked for, so it can be sent again.
	await expect(send(page)).toBeEnabled({ timeout: 20_000 });
});

test('offline, the form says it needs a connection and Send is off', async ({ page, context }) => {
	await openForm(page);
	await context.setOffline(true);
	await expect(page.getByText('Sending feedback needs a connection.')).toBeVisible();
	await expect(send(page)).toBeDisabled();
	await context.setOffline(false);
	await expect(send(page)).toBeEnabled({ timeout: 20_000 });
});
