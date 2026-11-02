import { appLocale } from './locale.ts';

const formats = new Map<string, Intl.DateTimeFormat>();

/**
 * e.g. "Wed 28 Oct 2026, 17:46" in en-GB, "Mi., 28. Okt. 2026, 17:46" in de-DE, in the device's
 * time zone.
 */
export function formatWhen(ms: number, locale = appLocale()): string {
	let when = formats.get(locale);
	if (!when) {
		when = new Intl.DateTimeFormat(locale, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
		formats.set(locale, when);
	}
	return when.format(ms);
}
