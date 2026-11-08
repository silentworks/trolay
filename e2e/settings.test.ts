import { expect, test } from '@playwright/test';
import { withPasskeys } from './passkeys';
import { menu } from './shared';

test('signed in, the Account & sync row says so', async ({ page }) => {
	await withPasskeys(page);
	await page.goto('/settings/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
	await page.getByRole('link', { name: 'Back to Settings' }).click();
	await expect(page.getByRole('link', { name: /^Account & sync/ })).toHaveText(
		'Account & sync Signed in'
	);
});

test('Settings lists its pages, with what each is set to', async ({ page }) => {
	await page.goto('/');
	await menu(page, 'Settings');
	await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

	const account = page.getByRole('region', { name: 'Your account' });
	await expect(account.getByRole('link')).toHaveText(['Account & sync Not signed in']);
	const app = page.getByRole('region', { name: 'App' });
	await expect(app.getByRole('link')).toHaveText([
		'Appearance Light',
		'Backup & restore',
		'Stores'
	]);
	const help = page.getByRole('region', { name: 'Help' });
	await expect(help.getByRole('link')).toHaveText([
		'Getting started guide',
		'Send feedback',
		'About Trolay'
	]);

	await page.getByRole('link', { name: 'Back to Trolley' }).click();
	await expect(page.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
});

test('each row opens its page, and its back button returns to Settings', async ({ page }) => {
	await page.goto('/settings');
	for (const [row, heading] of [
		['Account & sync', 'Account & sync'],
		['Appearance', 'Appearance'],
		['Backup & restore', 'Backup & restore'],
		['Send feedback', 'Send feedback'],
		['About Trolay', 'About Trolay']
	]) {
		await page.getByRole('link', { name: new RegExp(`^${row}`) }).click();
		await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
		await page.getByRole('link', { name: 'Back to Settings' }).click();
		await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
	}

	await page.getByRole('link', { name: 'Stores' }).click();
	await expect(page).toHaveURL(/\/stores$/);
	await page.goto('/settings');
	await page.getByRole('link', { name: 'Getting started guide' }).click();
	await expect(page.getByRole('heading', { name: 'Welcome to Trolay' })).toBeVisible();
});

test('About shows the version and links to the guide', async ({ page }) => {
	await page.goto('/settings/about');
	await expect(page.getByText('Version')).toBeVisible();
	// The short version is the build's date, with the full build number under it.
	await expect(page.getByText(/^\d{4}\.\d{2}\.\d{2}/)).toBeVisible();
	await expect(page.getByText(/^\d{13}$/)).toBeVisible();
	await expect(page.getByText('kept on this phone')).toBeVisible();
	await page.getByRole('link', { name: 'Show the getting started guide' }).click();
	await expect(page.getByRole('heading', { name: 'Welcome to Trolay' })).toBeVisible();
});

test('the Appearance row shows the look chosen', async ({ page }) => {
	await page.goto('/settings');
	await page.getByRole('link', { name: /^Appearance/ }).click();
	await page.getByRole('radio', { name: 'Dark', exact: true }).check();
	await page.getByRole('link', { name: 'Back to Settings' }).click();
	await expect(page.getByRole('link', { name: /^Appearance/ })).toHaveText('Appearance Dark');

	await page.getByRole('link', { name: /^Appearance/ }).click();
	await page.getByRole('radio', { name: 'System' }).check();
	await page.getByRole('link', { name: 'Back to Settings' }).click();
	await expect(page.getByRole('link', { name: /^Appearance/ })).toHaveText('Appearance System');
});

test('backups are made from Settings, not History', async ({ page }) => {
	await page.goto('/history');
	await expect(page.getByText('No finished trips yet.')).toBeVisible();
	await expect(page.getByRole('region', { name: 'Backup' })).toHaveCount(0);

	await page.goto('/settings/backup');
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download backup' }).click();
	expect((await download).suggestedFilename()).toMatch(/^trolay-backup-.*\.json$/);
	await expect(page.getByRole('button', { name: 'Restore a backup' })).toBeVisible();
});

test('the old Account address opens Account & sync in Settings', async ({ page }) => {
	await page.goto('/account');
	await expect(page).toHaveURL(/\/settings\/account$/);
	await expect(page.getByRole('heading', { name: 'Account & sync', level: 1 })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toBeVisible();
});
