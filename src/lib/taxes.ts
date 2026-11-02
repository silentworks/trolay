import { appLocale, phoneRegion } from './locale.ts';

// A guess at a new store's sales tax from the phone's region: the standard rate, which most
// shops' everyday goods carry. It only fills in the form; the shopper can always change it.
// Reduced rates on food and the like differ by item, so a store's rate is a starting point.

export interface RegionTax {
	/** Basis points: 2000 = 20%. */
	rateBps: number;
	/**
	 * The rate depends on the state, province or city (US, Canada, India, Brazil), so no single
	 * rate fits: the guess is 0% and the shopper is asked for theirs.
	 */
	varies: boolean;
}

const VARIES = new Set(['BR', 'CA', 'IN', 'US']);

// Standard rates in percent, as of 2026. Check them now and then: countries change them.
const STANDARD_RATE: Record<string, number> = {
	AE: 5,
	AT: 20,
	AU: 10,
	BE: 21,
	BG: 20,
	CH: 8.1,
	CY: 19,
	CZ: 21,
	DE: 19,
	DK: 25,
	EE: 24,
	ES: 21,
	FI: 25.5,
	FR: 20,
	GB: 20,
	GR: 24,
	HR: 25,
	HU: 27,
	IE: 23,
	IL: 18,
	IT: 22,
	JP: 10,
	KE: 16,
	LT: 21,
	LU: 17,
	LV: 21,
	MT: 18,
	MX: 16,
	NG: 7.5,
	NL: 21,
	NO: 25,
	NZ: 15,
	PH: 12,
	PL: 23,
	PT: 23,
	RO: 21,
	SA: 15,
	SE: 25,
	SG: 9,
	SI: 22,
	SK: 23,
	TH: 7,
	TR: 20,
	ZA: 15
};

/** The guess for the phone's region; undefined when the region isn't known. */
export function regionTax(locale = appLocale()): RegionTax | undefined {
	const region = phoneRegion(locale);
	if (!region) return undefined;
	if (VARIES.has(region)) return { rateBps: 0, varies: true };
	const rate = STANDARD_RATE[region];
	return rate === undefined ? undefined : { rateBps: Math.round(rate * 100), varies: false };
}
