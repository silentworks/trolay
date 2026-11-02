// The phone's own way of writing numbers and dates. Amounts, percentages and dates on screen
// follow it; files (CSV, backups) keep fixed forms so they read the same anywhere.

export const FALLBACK_LOCALE = 'en-GB';

/** The phone's first preferred language, e.g. "de-DE"; en-GB when it has none Intl knows. */
export function appLocale(): string {
	const wanted = globalThis.navigator?.languages?.[0] ?? globalThis.navigator?.language;
	if (!wanted) return FALLBACK_LOCALE;
	try {
		return Intl.getCanonicalLocales(wanted)[0] ?? FALLBACK_LOCALE;
	} catch {
		return FALLBACK_LOCALE;
	}
}

const separators = new Map<string, { decimal: string; group: string }>();

/** The decimal and digit-grouping marks of a locale: "." and "," in en-GB, "," and "." in de-DE. */
export function numberSeparators(locale = appLocale()): { decimal: string; group: string } {
	let found = separators.get(locale);
	if (!found) {
		const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
		found = {
			decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
			group: parts.find((part) => part.type === 'group')?.value ?? ','
		};
		separators.set(locale, found);
	}
	return found;
}

/** The phone's region, e.g. "DE" for de-DE, or the likeliest one for a bare language ("de"). */
export function phoneRegion(locale = appLocale()): string | undefined {
	try {
		return new Intl.Locale(locale).maximize().region;
	} catch {
		return undefined;
	}
}
