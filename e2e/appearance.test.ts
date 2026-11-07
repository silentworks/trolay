import { expect, test, type Page } from '@playwright/test';
import { BASE } from './global-setup';

const root = (page: Page, name: string) =>
	page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('an accent colour recolours the app at once, and is kept after a reload', async ({ page }) => {
	await page.goto('/settings/appearance');
	const colours = page.getByRole('radiogroup', { name: 'Accent colour' });
	await expect(colours).toHaveAccessibleDescription('Choose a colour that matches your style.');
	await expect(colours.getByRole('radio')).toHaveCount(6);
	await expect(colours.getByRole('radio', { name: 'Blue' })).toBeChecked();
	expect(await root(page, '--accent')).toBe('#1d4ed8');

	await colours.getByRole('radio', { name: 'Teal' }).check();
	expect(await root(page, '--accent')).toBe('#0f766e');
	await page.reload();
	await expect(colours.getByRole('radio', { name: 'Teal' })).toBeChecked();
	expect(await root(page, '--accent')).toBe('#0f766e');

	// Each colour has its own shade in dark.
	await page.getByRole('radio', { name: 'Dark', exact: true }).check();
	expect(await root(page, '--accent')).toBe('#2dd4bf');

	// And it's set before the app starts, on any page.
	await page.goto('/stores');
	expect(await page.evaluate(() => document.documentElement.dataset.accent)).toBe('teal');
});

test('the text size slider resizes text across the app, and is kept after a reload', async ({
	page
}) => {
	await page.goto('/settings/appearance');
	const slider = page.getByRole('slider', { name: 'Text size' });
	await expect(slider).toHaveAttribute('aria-valuetext', '100%');
	expect(await root(page, 'font-size')).toBe('17px');

	await slider.fill('4');
	await expect(slider).toHaveAttribute('aria-valuetext', '135%');
	expect(await root(page, 'font-size')).toBe('22.95px');
	await slider.press('ArrowLeft');
	await expect(slider).toHaveAttribute('aria-valuetext', '120%');

	await page.reload();
	await expect(slider).toHaveAttribute('aria-valuetext', '120%');
	expect(await root(page, 'font-size')).toBe('20.4px');
});

/**
 * What runs past the right edge of the screen, or is cut off by a box too narrow for it: its tag
 * and text, for the failure message.
 */
const overflowing = (page: Page) =>
	page.evaluate(() => {
		const edge = document.documentElement.clientWidth + 1;
		const out: string[] = [];
		if (document.documentElement.scrollWidth > edge) out.push('the page scrolls sideways');
		for (const el of document.querySelectorAll<HTMLElement>('body *')) {
			const box = el.getBoundingClientRect();
			if (!box.width || !el.checkVisibility()) continue;
			const style = getComputedStyle(el);
			// Cut off on purpose: text with an ellipsis, the swipe-to-delete hint, and text for screen
			// readers only.
			if (style.textOverflow === 'ellipsis' || el.closest('.swipe-hint, .visually-hidden')) {
				continue;
			}
			const clipped = style.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1;
			if (box.right > edge || (clipped && !['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName))) {
				out.push(`${el.tagName.toLowerCase()}.${el.className}: ${el.textContent?.slice(0, 40)}`);
			}
		}
		return out;
	});

test.describe('at the largest text size on a narrow phone', () => {
	test.use({ viewport: { width: 360, height: 760 } });

	test('nothing runs off the side of the screen', async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.setItem('trolley.textSize', '135'));
		await page.reload();
		expect(await root(page, 'font-size')).toBe('22.95px');
		expect(await overflowing(page), 'start screen').toEqual([]);

		await page.getByRole('button', { name: /^No stores yet/ }).click();
		await page.getByLabel('Store name').fill('Sainsbury’s Local');
		await page.getByLabel(/Branch or location/).fill('Watford High Street');
		expect(await overflowing(page), 'new store sheet').toEqual([]);
		await page.getByRole('button', { name: 'Add store and start trip' }).click();

		await page.getByRole('button', { name: 'Add by hand' }).click();
		const add = page.getByRole('dialog', { name: 'Add item' });
		await add.getByLabel('Description').fill('Semi-skimmed milk 4 pints');
		await add.getByLabel('Unit price').fill('1.45');
		await add.getByRole('switch', { name: 'Multi-buy offer' }).click();
		expect(await overflowing(page), 'add item sheet').toEqual([]);
		await add.getByRole('button', { name: 'Add to cart' }).click();
		await expect(add).toBeHidden();
		expect(await overflowing(page), 'trolley').toEqual([]);

		for (const path of ['/settings', '/settings/appearance', '/stores', '/history']) {
			await page.goto(path);
			await page.waitForLoadState('networkidle');
			expect(await overflowing(page), path).toEqual([]);
		}
	});
});

/** The heights of the visible buttons and links shorter than a 44px tap, with their names. */
const shortTaps = (page: Page) =>
	page.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('button, a[href], [role="switch"]')]
			.filter((el) => el.checkVisibility() && !el.closest('[inert], .visually-hidden'))
			.map((el) => ({ el, height: el.getBoundingClientRect().height }))
			.filter(({ height }) => height > 0 && height < 44)
			.map(
				({ el, height }) => `${el.textContent?.trim() || el.getAttribute('aria-label')}: ${height}`
			)
	);

test('the density spaces lists and sheets closer or further apart, and is kept', async ({
	page,
	browser
}) => {
	await page.goto('/');
	await page.getByRole('button', { name: /^No stores yet/ }).click();
	await page.getByLabel('Store name').fill('Tesco');
	await page.getByRole('button', { name: 'Add store and start trip' }).click();
	await page.getByRole('button', { name: 'Add by hand' }).click();
	await page.getByLabel('Description').fill('Milk');
	await page.getByLabel('Unit price').fill('1.45');
	await page.getByRole('button', { name: 'Add to cart' }).click();
	const row = page.getByRole('listitem').filter({ hasText: 'Milk' });
	const height = async () => (await row.boundingBox())!.height;
	const comfortable = await height();

	await page.goto('/settings/appearance');
	const densities = page.getByRole('radiogroup', { name: 'Interface density' });
	await expect(densities.getByRole('radio', { name: 'Comfortable' })).toBeChecked();
	await densities.getByRole('radio', { name: 'Compact' }).check();
	await page.goto('/');
	const compact = await height();
	expect(compact).toBeLessThan(comfortable);
	// Smaller spaces, never smaller taps.
	expect(await shortTaps(page)).toEqual([]);
	// The start screen, on a phone with no trip open.
	const fresh = await browser.newContext({
		baseURL: BASE,
		storageState: {
			cookies: [],
			origins: [
				{
					origin: BASE,
					localStorage: [
						{ name: 'trolley.onboarded', value: 'true' },
						{ name: 'trolley.whatsNewSeen', value: '9999.12.31' },
						{ name: 'trolley.density', value: 'compact' }
					]
				}
			]
		}
	});
	const start = await fresh.newPage();
	await start.goto('/');
	await expect(start.getByRole('heading', { name: 'Where are you shopping?' })).toBeVisible();
	expect(await shortTaps(start)).toEqual([]);
	await fresh.close();

	await page.goto('/settings/appearance');
	await densities.getByRole('radio', { name: 'Spacious' }).check();
	await page.reload();
	await expect(densities.getByRole('radio', { name: 'Spacious' })).toBeChecked();
	await page.goto('/');
	expect(await height()).toBeGreaterThan(comfortable);
});
