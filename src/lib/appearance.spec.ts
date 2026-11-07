import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENTS, readAccent } from './appearance.ts';

// The colours as app.css has them, for each accent in light and dark.
const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

function tokens(selector: string): Record<string, string> {
	const start = css.indexOf(`${selector} {`);
	if (start < 0) return {};
	const body = css.slice(start, css.indexOf('}', start));
	return Object.fromEntries(
		[...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map(([, name, value]) => [name, value])
	);
}

function palette(accent: string, theme: 'light' | 'dark'): Record<string, string> {
	const dark = theme === 'dark';
	return {
		...tokens(':root'),
		...(dark ? tokens(":root[data-theme='dark']") : {}),
		...tokens(`:root[data-accent='${accent}']`),
		...(dark ? tokens(`:root[data-theme='dark'][data-accent='${accent}']`) : {})
	};
}

function luminance(hex: string): number {
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

describe('accent colours', () => {
	for (const { value, label, light, dark } of ACCENTS) {
		for (const theme of ['light', 'dark'] as const) {
			it(`${label} in ${theme} keeps text readable`, () => {
				const c = palette(value, theme);
				expect(c.accent).toBe(theme === 'light' ? light : dark);
				// Text on the accent: buttons.
				expect(contrast(c['on-accent'], c.accent)).toBeGreaterThanOrEqual(4.5);
				// The accent as text, on the page and on cards.
				expect(contrast(c.accent, c.bg)).toBeGreaterThanOrEqual(4.5);
				expect(contrast(c.accent, c.surface)).toBeGreaterThanOrEqual(4.5);
				// The chosen pills and cards.
				expect(contrast(c['accent-soft-text'], c['accent-soft'])).toBeGreaterThanOrEqual(4.5);
				// A pressed button, and the focus ring against the page (3:1 for what isn't text).
				expect(contrast(c['on-accent'], c['accent-strong'])).toBeGreaterThanOrEqual(4.5);
				expect(contrast(c.focus, c.bg)).toBeGreaterThanOrEqual(3);
			});
		}
	}

	it('reads an unknown or missing choice as blue', () => {
		expect(readAccent(null)).toBe('blue');
		expect(readAccent('rainbow')).toBe('blue');
		expect(readAccent('teal')).toBe('teal');
	});
});
