// What a feedback message may hold, shared by the form in Settings and the API that emails it
// (worker/feedback.ts), so both check the same rules.

export const TOPICS = ['Idea', 'Problem', 'Something else'] as const;
export type Topic = (typeof TOPICS)[number];

export const MIN_MESSAGE = 10;
export const MAX_MESSAGE = 2000;
/** From here on the form shows how many characters are left. */
export const COUNT_FROM = 1800;

/** The details about the phone that may come with a message, in the order they're shown. */
export const DETAIL_LABELS = {
	version: 'App version',
	userAgent: 'Browser and system',
	screen: 'Screen size',
	theme: 'Theme',
	installed: 'Installed',
	signedIn: 'Signed in'
} as const;
export type DetailKey = keyof typeof DETAIL_LABELS;
export type Details = Partial<Record<DetailKey, string>>;
/** The longest a detail may be; a user agent is the longest, at a few hundred characters. */
export const MAX_DETAIL = 500;

/**
 * Something that looks like an email address: one @, a dot in the domain, and no spaces, commas
 * or angle brackets, so it can only ever be one address in a Reply-To header.
 */
export function looksLikeEmail(value: string): boolean {
	return value.length <= 254 && /^[^\s@,;<>()"]+@[^\s@,;<>()"]+\.[^\s@,;<>()".]+$/.test(value);
}

export function isTopic(value: unknown): value is Topic {
	return TOPICS.includes(value as Topic);
}

/** The message as it is checked: without spaces at either end. */
export function messageLength(message: string): number {
	return message.trim().length;
}
