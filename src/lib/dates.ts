const when = new Intl.DateTimeFormat('en-GB', {
	weekday: 'short',
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
});

/** e.g. "Wed 28 Oct 2026, 17:46", in the device's time zone. */
export function formatWhen(ms: number): string {
	return when.format(ms);
}
