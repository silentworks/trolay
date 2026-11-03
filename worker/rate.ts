import { sha256 } from './auth/tokens.ts';
import type { Env } from './env.ts';

export const HOUR = 60 * 60 * 1000;

/**
 * Who is asking, for per-source limits. An IPv6 address counts by its /64, which is what one
 * connection is usually given: otherwise every address in it would be a fresh source. Hashed, so
 * no address is stored.
 */
export function sourceOf(ip: string | null): string {
	if (!ip?.includes(':')) return ip ?? 'unknown';
	const [head, tail = ''] = ip.toLowerCase().split('::');
	const front = head ? head.split(':') : [];
	const back = tail ? tail.split(':') : [];
	const groups = ip.includes('::')
		? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill('0'), ...back]
		: front;
	return `${groups
		.slice(0, 4)
		.map((group) => group.replace(/^0+(?=.)/, ''))
		.join(':')}::/64`;
}

export const source = async (request: Request) =>
	sha256(sourceOf(request.headers.get('CF-Connecting-IP')));

export interface Limit {
	/** What is limited and for whom, e.g. "challenge:<source>". */
	key: string;
	max: number;
	/** How far back it counts; at most an hour, which is how long rows are kept. */
	window: number;
}

/**
 * Counts a request against every limit, or refuses it when any is used up (and then counts it
 * against none). Two requests at the same moment can both squeeze in under a limit; these are
 * ceilings on abuse, not exact quotas.
 */
export async function withinLimits(env: Env, limits: Limit[]): Promise<boolean> {
	const now = Date.now();
	const counts = await env.DB.batch(
		limits.map(({ key, window }) =>
			env.DB.prepare('SELECT COUNT(*) AS n FROM rate_events WHERE key = ? AND at > ?').bind(
				key,
				now - window
			)
		)
	);
	if (limits.some((limit, i) => ((counts[i].results[0] as { n: number }).n ?? 0) >= limit.max)) {
		return false;
	}
	await env.DB.batch([
		env.DB.prepare('DELETE FROM rate_events WHERE at < ?').bind(now - HOUR),
		...limits.map(({ key }) =>
			env.DB.prepare('INSERT INTO rate_events (key, at) VALUES (?, ?)').bind(key, now)
		)
	]);
	return true;
}
