import { appLocale } from './locale.ts';

// What changed in each release, for shoppers: shown once after an update (WhatsNew.svelte) and
// in Settings › About › What's new. How to write an entry: see docs/changelog.md.

export interface ChangelogEntry {
	/** The release's short version, as About shows it: "2026.11.07". */
	version: string;
	added?: string[];
	changed?: string[];
	removed?: string[];
	fixed?: string[];
}

export const SECTIONS = [
	{ key: 'added', title: 'Added' },
	{ key: 'changed', title: 'Changed' },
	{ key: 'removed', title: 'Removed' },
	{ key: 'fixed', title: 'Fixed' }
] as const;

/** Newest first. */
export const CHANGELOG: ChangelogEntry[] = [
	{
		version: '2026.11.12',
		added: [
			'A Finish trip button beside the total, ready for the till.',
			"Back after a break with items in your trolley? Trolay asks if you're done shopping, so you can finish the trip and check your receipt."
		],
		changed: [
			'A new app icon: a white T on two green wheels, in blue.',
			'“Read the receipt” is now “Snap receipt total”, with the same camera as Snap price.'
		]
	},
	{
		version: '2026.11.10',
		changed: [
			'The sync icon beside the title is smaller, and shows only while syncing, or in red after a sync fails until one goes through.'
		]
	},
	{
		version: '2026.11.09',
		changed: [
			'The budget, discount, finish trip and feedback forms, and the getting started guide, are laid out like Add item: one row per thing, with switches in place of tick boxes.'
		]
	},
	{
		version: '2026.11.08',
		added: ['Send feedback: tell us an idea or a problem, from Settings › Help.']
	},
	{
		version: '2026.11.07',
		added: [
			"What's new: after an update, see what changed. It's in Settings › About too.",
			'A “No stores yet” card on the home and Stores pages, to add your first store.'
		],
		changed: [
			'Settings is one page now, with Account & sync, Appearance, Backup & restore and About.',
			'The version on About reads as a date, like 2026.11.07.',
			"The home page doesn't ask for a trip budget any more. Set one from the trolley."
		],
		removed: ['The separate Account page: it lives in Settings now.']
	},
	{
		version: '2026.11.06',
		added: [
			'Undo after deleting all your history.',
			'A sync icon beside the title that turns while syncing, then shows a green tick.'
		]
	},
	{
		version: '2026.11.05',
		added: [
			'A banner offering to install Trolay on your home screen.',
			'Undo after deleting a store or a trip.'
		],
		changed: [
			'Messages like “Trip saved” and “Link copied” pop up briefly at the bottom of the screen.',
			'The item sheet is laid out in rows, with switches for tax and multi-buy offers.',
			'A new version is offered in a banner at the bottom of the screen.'
		]
	},
	{
		version: '2026.11.03',
		changed: [
			'Longer explanations sit behind an ⓘ button.',
			'Simpler back and menu buttons at the top of each screen.'
		],
		removed: ['Signing in by email: accounts use passkeys for now.']
	},
	{
		version: '2026.11.02',
		added: [
			'A step-by-step guide for your first trip.',
			'Multi-buy offers, read from shelf labels and taken off the line total.',
			'A currency for each store.',
			'Light, Dark or Match my phone, in Settings.'
		],
		changed: [
			'A new look, with a blue accent, a budget bar and a dark total card.',
			'Amounts, percentages and dates follow your phone’s format.',
			'Sales tax instead of VAT, and shelf prices without tax for the US and Canada.'
		]
	}
];

/**
 * SvelteKit names each build by the time it was made: the date of it, as "2026.11.07". Anything
 * else (a version that isn't a time) is kept as it is.
 */
export function shortVersion(version: string): string {
	if (!/^\d+$/.test(version)) return version;
	const at = new Date(Number(version));
	return [
		at.getUTCFullYear(),
		String(at.getUTCMonth() + 1).padStart(2, '0'),
		String(at.getUTCDate()).padStart(2, '0')
	].join('.');
}

/** The entries released after `seen` (a short version), newest first. */
export function entriesAfter(
	seen: string,
	entries: ChangelogEntry[] = CHANGELOG
): ChangelogEntry[] {
	return entries.filter((entry) => entry.version > seen);
}

/**
 * What to show this phone, given the newest entry it has seen: nothing on a phone that has never
 * been used (a first install sees the guide instead), and the newest entry on one that was in use
 * before this was kept.
 */
export function unseen(
	seen: string | null,
	used: boolean,
	entries: ChangelogEntry[] = CHANGELOG
): ChangelogEntry[] {
	if (seen === null) return used ? entries.slice(0, 1) : [];
	return entriesAfter(seen, entries);
}

const formats = new Map<string, Intl.DateTimeFormat>();

/** "7 November 2026" for "2026.11.07", in the phone's language. */
export function releaseDate(version: string, locale = appLocale()): string {
	const parts = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(version);
	if (!parts) return version;
	let format = formats.get(locale);
	if (!format) {
		format = new Intl.DateTimeFormat(locale, {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
		formats.set(locale, format);
	}
	return format.format(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
}
