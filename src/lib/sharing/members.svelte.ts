// Who is on the open trip, so a shared trip can say who added each item. Asked of the server
// (which holds the members), and empty until it answers, or when there is no signal or account.

export interface TripMember {
	id: string;
	role: 'owner' | 'partner';
	/** What the person goes by, when they have given an email; null for a passkey-only account. */
	name: string | null;
}

export class TripMembers {
	list = $state<TripMember[]>([]);
	private tripId?: string;

	/** More than one person is on the trip. */
	shared = $derived(this.list.length > 1);

	async refresh(tripId: string): Promise<void> {
		if (this.tripId !== tripId) {
			this.tripId = tripId;
			this.list = [];
		}
		try {
			const response = await fetch(`/api/trips/members?trip=${encodeURIComponent(tripId)}`);
			if (!response.ok) {
				// Not on the server yet, or signed out: nobody else is on the trip as far as this
				// phone can tell.
				if (this.tripId === tripId) this.list = [];
				return;
			}
			const { members } = (await response.json()) as { members: TripMember[] };
			if (this.tripId === tripId) this.list = members;
		} catch {
			// No signal: what was known stays.
		}
	}

	/** "you", a name, or the role, for the line under an item; nothing when the trip is not shared. */
	label(addedBy: string | undefined, me: string | undefined): string | undefined {
		if (!this.shared || !addedBy) return undefined;
		return describeAdder(this.list, addedBy, me);
	}

	/** This phone's own role on the trip. */
	roleOf(me: string | undefined): TripMember['role'] | undefined {
		return this.list.find((member) => member.id === me)?.role;
	}
}

export function describeAdder(
	members: TripMember[],
	addedBy: string,
	me: string | undefined
): string {
	if (addedBy === me) return 'you';
	const member = members.find((m) => m.id === addedBy);
	if (!member) return 'someone who has left';
	return member.name ?? (member.role === 'owner' ? 'the trip owner' : 'your partner');
}
