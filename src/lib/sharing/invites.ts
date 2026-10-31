// Sharing a trip with a partner: making an invite link, and accepting one. Both need an account.

const MESSAGES: Record<string, string> = {
	unauthorized: 'Sign in to do that.',
	trip_not_found: "This trip hasn't reached your account yet. Check your connection and try again.",
	trip_finished: 'This trip has finished, so it can no longer be shared.',
	trip_full: 'This trip already has a partner.',
	too_many_requests: 'Too many invites. Try again later.',
	invite_invalid: 'That invite has expired or was already used. Ask for a new link.',
	own_trip: "That's your own trip: send the link to your partner instead.",
	already_member: "You've already joined this trip.",
	no_partner: 'This trip has no partner.'
};

export class InviteError extends Error {
	constructor(
		readonly code: string,
		message: string
	) {
		super(message);
	}
}

async function post<T>(path: string, body: unknown): Promise<T> {
	let response: Response;
	try {
		response = await fetch(path, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	} catch {
		throw new InviteError('offline', 'You need a connection to do that.');
	}
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		const code = typeof data?.error === 'string' ? data.error : 'error';
		throw new InviteError(code, MESSAGES[code] ?? 'Something went wrong. Try again.');
	}
	return data as T;
}

/** A link that lets one other person join this open trip. It works once, for a day. */
export async function createInviteLink(tripId: string): Promise<string> {
	return (await post<{ link: string }>('/api/trips/invite', { tripId })).link;
}

/** The partner leaves the trip. The phone lets go of it afterwards (src/lib/sync/letgo.ts). */
export async function leaveSharedTrip(tripId: string): Promise<void> {
	await post('/api/trips/leave', { tripId });
}

/** The owner takes the partner off the trip. */
export async function removeTripPartner(tripId: string): Promise<void> {
	await post('/api/trips/remove-partner', { tripId });
}

export interface JoinedTrip {
	tripId: string;
	store: { name: string; branch?: string | null };
}

export function joinTrip(token: string): Promise<JoinedTrip> {
	return post<JoinedTrip>('/api/trips/join', { token });
}

// An invite opened while signed out waits here (this tab only) until the person has signed in.
const PENDING = 'trolay-pending-invite';

export function rememberInvite(token: string): void {
	try {
		sessionStorage.setItem(PENDING, token);
	} catch {
		// Without storage the link has to be opened again after signing in.
	}
}

export function pendingInvite(): string | undefined {
	try {
		return sessionStorage.getItem(PENDING) ?? undefined;
	} catch {
		return undefined;
	}
}

export function forgetInvite(): void {
	try {
		sessionStorage.removeItem(PENDING);
	} catch {
		// Nothing to forget.
	}
}
