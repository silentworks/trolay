import { appLocale } from './locale.ts';

// The currencies a store can be set to. Amounts are kept in hundredths, so only currencies
// written with two decimals are offered: yen (none) or dinar (three) would show wrong amounts.

export interface CurrencyOption {
	/** ISO 4217 code, e.g. "EUR". */
	code: string;
	/** In the phone's language, e.g. "Euro". */
	name: string;
}

function hasTwoDecimals(code: string): boolean {
	try {
		const options = new Intl.NumberFormat('en', {
			style: 'currency',
			currency: code
		}).resolvedOptions();
		return options.maximumFractionDigits === 2;
	} catch {
		return false;
	}
}

/** A code Trolay can show amounts in: ISO 4217, written with two decimals. */
export function isSupportedCurrency(code: string): boolean {
	return /^[A-Z]{3}$/.test(code) && hasTwoDecimals(code);
}

let options: { locale: string; list: CurrencyOption[] } | undefined;

/** Every supported currency, by name in the phone's language. */
export function currencyOptions(locale = appLocale()): CurrencyOption[] {
	if (options?.locale === locale) return options.list;
	const names = new Intl.DisplayNames(locale, { type: 'currency' });
	const list = Intl.supportedValuesOf('currency')
		.filter(isSupportedCurrency)
		.map((code) => ({ code, name: names.of(code) ?? code }))
		.sort((a, b) => a.name.localeCompare(b.name, locale));
	options = { locale, list };
	return list;
}

// Each region's everyday currency, for the regions people are most likely to shop in. Intl has
// no lookup for this. A region not here gets no guess.
const EURO = 'AT BE BG CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK';
const REGION_CURRENCY: Record<string, string> = {
	...Object.fromEntries(EURO.split(' ').map((region) => [region, 'EUR'])),
	AE: 'AED',
	AU: 'AUD',
	BR: 'BRL',
	CA: 'CAD',
	CH: 'CHF',
	CN: 'CNY',
	CZ: 'CZK',
	DK: 'DKK',
	GB: 'GBP',
	GH: 'GHS',
	HK: 'HKD',
	HU: 'HUF',
	IL: 'ILS',
	IN: 'INR',
	KE: 'KES',
	MX: 'MXN',
	MY: 'MYR',
	NG: 'NGN',
	NO: 'NOK',
	NZ: 'NZD',
	PH: 'PHP',
	PL: 'PLN',
	RO: 'RON',
	SA: 'SAR',
	SE: 'SEK',
	SG: 'SGD',
	TH: 'THB',
	TR: 'TRY',
	US: 'USD',
	ZA: 'ZAR'
};

/** The currency of the phone's region, e.g. "EUR" for de-DE; undefined when unknown. */
export function regionCurrency(locale = appLocale()): string | undefined {
	try {
		const region = new Intl.Locale(locale).maximize().region;
		const code = region ? REGION_CURRENCY[region] : undefined;
		return code && isSupportedCurrency(code) ? code : undefined;
	} catch {
		return undefined;
	}
}
