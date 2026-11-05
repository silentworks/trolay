import { expect, test, type Page } from '@playwright/test';
import { menu } from './shared';

// A phone opening Trolay for the first time.
test.use({ storageState: { cookies: [], origins: [] } });

const UK_ONLY = /£|\bGBP\b|\bpence\b|\bVAT\b/i;

/**
 * The page's text and accessible names, with currency pickers left out: their list of every
 * currency rightly names the pound.
 */
async function wording(page: Page): Promise<string> {
	return page.evaluate(() => {
		const copy = document.body.cloneNode(true) as HTMLElement;
		copy.querySelectorAll('select').forEach((select) => select.remove());
		const labels = [...copy.querySelectorAll('[aria-label], [placeholder], [title]')].flatMap(
			(element) =>
				['aria-label', 'placeholder', 'title'].map((name) => element.getAttribute(name) ?? '')
		);
		return [copy.textContent ?? '', ...labels].join('\n');
	});
}

async function expectNeutral(page: Page, screen: string) {
	expect(await wording(page), screen).not.toMatch(UK_ONLY);
}

test('no screen speaks of pounds, pence or VAT for a store with no currency', async ({ page }) => {
	await page.goto('/');
	await expectNeutral(page, 'welcome');
	await page.getByRole('button', { name: 'Get started' }).click();
	await page.getByLabel('Store name').fill('Corner Shop');
	await page.getByLabel('Currency', { exact: true }).selectOption({ label: 'None' });
	await expectNeutral(page, 'guide: store');
	await page.getByRole('button', { name: 'Next' }).click();
	await expectNeutral(page, 'guide: sales tax');
	await page.getByRole('button', { name: 'Next' }).click();
	await expectNeutral(page, 'guide: budget');
	await page.getByRole('button', { name: 'No budget' }).click();
	await expectNeutral(page, 'guide: ready');
	await page.getByRole('button', { name: 'Start shopping' }).click();

	await page.getByRole('button', { name: 'Add by hand' }).click();
	const add = page.getByRole('dialog', { name: 'Add item' });
	await add.getByLabel('Description').fill('Tea');
	await add.getByLabel('Unit price').fill('2.50');
	await expectNeutral(page, 'add item');
	await add.getByRole('button', { name: 'Add to cart' }).click();
	await expect(page.getByRole('region', { name: 'Trolley total' })).toContainText('2.50');
	await expectNeutral(page, 'cart');

	await menu(page, 'Add discount');
	await expectNeutral(page, 'discount');
	await page
		.getByRole('dialog', { name: 'Discount' })
		.getByRole('button', { name: 'Close' })
		.click();
	await page.getByRole('button', { name: 'Set a budget' }).click();
	await expectNeutral(page, 'budget');
	await page
		.getByRole('dialog', { name: 'Trip budget' })
		.getByRole('button', { name: 'Close' })
		.click();

	await menu(page, 'Finish trip');
	const finish = page.getByRole('dialog', { name: 'Finish trip' });
	await finish.getByLabel('Receipt total', { exact: true }).fill('2.60');
	await expect(finish).toContainText('The till charged 0.10 more');
	await expectNeutral(page, 'finish');
	await finish.getByLabel('Receipt total', { exact: true }).fill('2.50');
	await finish.getByRole('button', { name: 'Finish trip' }).click();
	await expect(page.getByRole('group', { name: 'Message' }).getByRole('status')).toHaveText(
		'Trip saved'
	);

	await page.goto('/history');
	await expect(page.getByRole('list', { name: 'Past trips' })).toContainText('2.50');
	await expectNeutral(page, 'history');
	await page.getByRole('list', { name: 'Past trips' }).getByRole('link').click();
	await expect(page.getByLabel('Trip totals')).toBeVisible();
	await expectNeutral(page, 'trip page');

	await page.goto('/stores');
	await expectNeutral(page, 'stores');
	await page.getByRole('button', { name: /Corner Shop/ }).click();
	await expectNeutral(page, 'edit store');
	await page.goto('/account');
	await expectNeutral(page, 'account');
});
