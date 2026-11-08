import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { withPasskeys } from './passkeys';

test('the page refuses framing, and nothing the app does breaks its content policy', async ({
	page
}) => {
	// Every policy violation on the page, as the browser reports it.
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as { violations: string[] }).violations = seen;
		document.addEventListener('securitypolicyviolation', (event) =>
			seen.push(`${event.effectiveDirective} ${event.blockedURI}`)
		);
	});
	const violations = () =>
		page.evaluate(() => (window as unknown as { violations: string[] }).violations);

	const reply = await page.goto('/');
	const headers = reply!.headers();
	// Production sends only this in the header; the preview server sends the whole policy.
	expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
	expect(headers['x-frame-options']).toBe('DENY');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['referrer-policy']).toBe('same-origin');
	// In production the rest of the policy is a <meta> in the built index.html, which Cloudflare
	// serves as it is; the preview server renders the page itself and sends it as the header.
	const built = readFileSync('build/index.html', 'utf8');
	const meta = /<meta http-equiv="content-security-policy" content="([^"]+)"/.exec(built)?.[1];
	for (const policy of [meta, headers['content-security-policy']]) {
		expect(policy).toContain(
			"script-src 'self' 'wasm-unsafe-eval' https://challenges.cloudflare.com 'sha256-"
		);
		expect(policy).toContain('frame-src https://challenges.cloudflare.com');
		expect(policy).toContain("object-src 'none'");
	}

	// The saved look still applies before the app starts, from its own file.
	expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');

	// Shop a little, sign up and let it sync: none of it may trip the policy.
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await page.getByRole('button', { name: 'Add by hand' }).click();
	const add = page.getByRole('dialog', { name: 'Add item' });
	await add.getByLabel('Description').fill('Bread');
	await add.getByLabel('Unit price').fill('1.20');
	await add.getByRole('button', { name: 'Add to cart' }).click();
	await expect(page.getByRole('region', { name: 'Trolley total' })).toContainText('1.20');

	await withPasskeys(page);
	await page.goto('/settings/account');
	await page.getByRole('button', { name: 'Create an account with a passkey' }).click();
	await expect(page.getByText("You're signed in on this device.")).toBeVisible();
	await expect(page.getByText(/synced/i).first()).toBeVisible();
	expect(await violations()).toEqual([]);

	// The API answers carry nosniff too.
	const api = await page.request.get('/api/auth/me');
	expect(api.headers()['x-content-type-options']).toBe('nosniff');
});
