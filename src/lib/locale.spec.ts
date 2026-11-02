import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatWhen } from './dates.ts';
import { appLocale, numberSeparators } from './locale.ts';

describe('appLocale', () => {
	afterEach(() => vi.unstubAllGlobals());

	it("uses the phone's first preferred language", () => {
		vi.stubGlobal('navigator', { languages: ['de-de', 'en-GB'], language: 'de-de' });
		expect(appLocale()).toBe('de-DE');
	});

	it('falls back to en-GB without a usable language', () => {
		vi.stubGlobal('navigator', { languages: [], language: '' });
		expect(appLocale()).toBe('en-GB');
		vi.stubGlobal('navigator', { languages: ['not a locale!'] });
		expect(appLocale()).toBe('en-GB');
	});
});

describe('numberSeparators', () => {
	it('gives each locale its marks', () => {
		expect(numberSeparators('en-GB')).toEqual({ decimal: '.', group: ',' });
		expect(numberSeparators('de-DE')).toEqual({ decimal: ',', group: '.' });
		expect(numberSeparators('fr-FR')).toEqual({ decimal: ',', group: ' ' });
	});
});

describe('formatWhen', () => {
	// Noon UTC, so the day is the same in any time zone the tests run in.
	const noon = Date.UTC(2026, 10, 2, 12, 0);

	it('writes dates the way the locale does', () => {
		expect(formatWhen(noon, 'en-GB')).toMatch(/^Mon,? 2 Nov 2026, \d\d:00$/);
		expect(formatWhen(noon, 'en-US')).toMatch(/^Mon, Nov 2, 2026, \d\d:00 (AM|PM)$/);
		expect(formatWhen(noon, 'de-DE')).toMatch(/^Mo\., 2\. Nov\. 2026, \d\d:00$/);
	});
});
