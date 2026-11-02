import { describe, expect, it } from 'vitest';
import { currencyOptions, isSupportedCurrency, regionCurrency } from './currencies.ts';

describe('isSupportedCurrency', () => {
	it('takes ISO codes written with two decimals', () => {
		expect(isSupportedCurrency('EUR')).toBe(true);
		expect(isSupportedCurrency('GBP')).toBe(true);
		expect(isSupportedCurrency('USD')).toBe(true);
	});

	it('refuses currencies with no or three decimals, and anything that is not a code', () => {
		expect(isSupportedCurrency('JPY')).toBe(false);
		expect(isSupportedCurrency('KWD')).toBe(false);
		expect(isSupportedCurrency('eur')).toBe(false);
		expect(isSupportedCurrency('EURO')).toBe(false);
		expect(isSupportedCurrency('')).toBe(false);
	});
});

describe('currencyOptions', () => {
	it('lists supported currencies by name in the phone language', () => {
		const list = currencyOptions('en-GB');
		expect(list).toContainEqual({ code: 'EUR', name: 'Euro' });
		expect(list.some(({ code }) => code === 'JPY')).toBe(false);
		const names = list.map(({ name }) => name);
		expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en-GB')));
		expect(currencyOptions('de-DE')).toContainEqual({ code: 'GBP', name: 'Britisches Pfund' });
	});
});

describe('regionCurrency', () => {
	it("guesses from the phone's region", () => {
		expect(regionCurrency('en-GB')).toBe('GBP');
		expect(regionCurrency('de-DE')).toBe('EUR');
		expect(regionCurrency('fr-CA')).toBe('CAD');
		expect(regionCurrency('en-US')).toBe('USD');
		// No region given: the likeliest one for the language.
		expect(regionCurrency('de')).toBe('EUR');
	});

	it('makes no guess for regions it does not know, or whose currency is not supported', () => {
		expect(regionCurrency('ja-JP')).toBeUndefined();
		expect(regionCurrency('en-001')).toBeUndefined();
	});
});
