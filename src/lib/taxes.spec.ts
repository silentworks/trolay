import { describe, expect, it } from 'vitest';
import { regionTax } from './taxes.ts';

describe('regionTax', () => {
	it("guesses the standard rate from the phone's region", () => {
		expect(regionTax('en-GB')).toEqual({ rateBps: 2000, varies: false, addedAtTill: false });
		expect(regionTax('de-DE')).toEqual({ rateBps: 1900, varies: false, addedAtTill: false });
		expect(regionTax('fr-FR')).toEqual({ rateBps: 2000, varies: false, addedAtTill: false });
		expect(regionTax('en-AU')).toEqual({ rateBps: 1000, varies: false, addedAtTill: false });
		expect(regionTax('fi-FI')).toEqual({ rateBps: 2550, varies: false, addedAtTill: false });
		// No region given: the likeliest one for the language.
		expect(regionTax('de')).toEqual({ rateBps: 1900, varies: false, addedAtTill: false });
	});

	it('starts at 0% where the rate depends on the state or province, and knows where tills add it', () => {
		expect(regionTax('en-US')).toEqual({ rateBps: 0, varies: true, addedAtTill: true });
		expect(regionTax('fr-CA')).toEqual({ rateBps: 0, varies: true, addedAtTill: true });
		expect(regionTax('hi-IN')).toEqual({ rateBps: 0, varies: true, addedAtTill: false });
	});

	it('makes no guess for a region it does not know', () => {
		expect(regionTax('en-001')).toBeUndefined();
		expect(regionTax('not a locale!')).toBeUndefined();
	});
});
