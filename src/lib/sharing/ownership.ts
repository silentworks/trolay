// Only a trip's owner may delete it, and a store belongs to the account that made it. The server
// refuses anything else, but by then the phone has already deleted its copy, so the app asks first.

import { account } from '#lib/auth/account.svelte.ts';
import type { TripMember } from './members.svelte.ts';

/** Of these trips, the ones this account is only a partner on. */
export async function tripsSharedWithMe(tripIds: string[]): Promise<Set<string>> {
	const partner = new Set<string>();
	// Never signed in: every trip on the phone is its own.
	if (account.status === 'signedOut' || (account.status === 'unknown' && !account.maybeSignedIn)) {
		return partner;
	}
	if (account.status !== 'signedIn') throw new Error('You need a connection to do that.');
	for (const id of tripIds) {
		let response: Response;
		try {
			response = await fetch(`/api/trips/members?trip=${encodeURIComponent(id)}`);
		} catch {
			throw new Error('You need a connection to do that.');
		}
		// Not on the server (yet): nobody else is on it.
		if (!response.ok) continue;
		const { members } = (await response.json()) as { members: TripMember[] };
		if (members.find((member) => member.id === account.userId)?.role === 'partner') partner.add(id);
	}
	return partner;
}
