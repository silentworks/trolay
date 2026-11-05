import { expect, test, type Page } from '@playwright/test';

// A phone's width.
test.use({ viewport: { width: 360, height: 740 } });

const banner = (page: Page) => page.getByRole('complementary', { name: 'Install the app' });
// It waits a few seconds before showing.
const SHOWN = { timeout: 10_000 };

/** What Chrome sends when the app can be installed; records whether its dialog was opened. */
async function offerInstall(page: Page, outcome: 'accepted' | 'dismissed' = 'accepted') {
	// Once the app is up and listening for it.
	await expect(page.getByRole('button').first()).toBeVisible();
	await page.evaluate((outcome) => {
		const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
			prompt: async () => ((window as unknown as { prompted: boolean }).prompted = true),
			userChoice: Promise.resolve({ outcome })
		});
		window.dispatchEvent(event);
	}, outcome);
}

async function startTrip(page: Page) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Add a new store' }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await expect(page.getByRole('region', { name: 'Trolley total' })).toBeVisible();
}

test('the install banner opens the browser’s install dialog, and then stays away', async ({
	page
}) => {
	await page.goto('/');
	await offerInstall(page);
	await expect(banner(page)).toContainText('Install Trolay for quick access!', SHOWN);
	await banner(page).getByRole('button', { name: 'Install' }).click();
	await expect(banner(page)).toBeHidden();
	expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(
		true
	);

	await page.reload();
	await offerInstall(page);
	await page.waitForTimeout(5000);
	await expect(banner(page)).toBeHidden();
});

test('Later is remembered', async ({ page }) => {
	await page.goto('/');
	await offerInstall(page);
	await expect(banner(page)).toBeVisible(SHOWN);
	await banner(page).getByRole('button', { name: 'Later' }).click();
	await expect(banner(page)).toBeHidden();
	await page.reload();
	await offerInstall(page);
	await page.waitForTimeout(5000);
	await expect(banner(page)).toBeHidden();
});

test('on the cart the banner sits above the totals, and a toast above the banner', async ({
	page
}) => {
	await startTrip(page);
	await offerInstall(page);
	await expect(banner(page)).toBeVisible(SHOWN);
	await banner(page).evaluate((card) =>
		Promise.all(card.getAnimations().map((each) => each.finished))
	);
	const card = (await banner(page).boundingBox())!;
	const total = (await page.getByRole('region', { name: 'Trolley total' }).boundingBox())!;
	expect(card.y + card.height).toBeLessThanOrEqual(total.y);

	await page.getByRole('button', { name: 'Add by hand' }).click();
	const sheet = page.getByRole('dialog', { name: 'Add item' });
	await sheet.getByLabel('Description').fill('Bread');
	await sheet.getByLabel('Unit price').fill('1.10');
	await sheet.getByRole('button', { name: 'Add to cart' }).click();
	await page.getByRole('button', { name: 'Delete Bread' }).click();
	const toast = page.getByRole('group', { name: 'Message' });
	await expect(toast).toBeVisible();
	await toast.evaluate((card) => Promise.all(card.getAnimations().map((each) => each.finished)));
	const message = (await toast.boundingBox())!;
	expect(message.y + message.height).toBeLessThanOrEqual(card.y);
});

test.describe('on an iPhone', () => {
	test.use({
		userAgent:
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
	});

	test('the banner says how to add the app to the Home Screen', async ({ page }) => {
		await page.goto('/');
		await expect(banner(page)).toContainText('tap Share, then Add to Home Screen', SHOWN);
		await banner(page).getByRole('button', { name: 'Got it' }).click();
		await expect(banner(page)).toBeHidden();
		await page.reload();
		await page.waitForTimeout(5000);
		await expect(banner(page)).toBeHidden();
	});
});
