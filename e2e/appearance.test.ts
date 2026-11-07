import { expect, test, type Page } from '@playwright/test';

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
