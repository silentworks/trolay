<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { account } from '#lib/auth/account.svelte.ts';
	import { db, isLive } from '#lib/data/db.ts';
	import { getOpenTrip } from '#lib/data/trips.ts';
	import { describeAdder, TripMembers } from '#lib/sharing/members.svelte.ts';
	import type { ArrivedItem } from '#lib/sync/core.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';

	// Says so when the partner on the open trip adds items, on whatever screen is showing.
	const members = new TripMembers();

	$effect(() => {
		const items = syncEngine.arrived;
		if (!items.length) return;
		syncEngine.arrived = [];
		void tell(items);
	});

	async function tell(arrived: ArrivedItem[]) {
		const me = account.userId;
		const trip = await getOpenTrip();
		if (!trip || !me) return;
		const theirs = arrived.filter(
			(item) => item.tripId === trip.id && item.addedBy && item.addedBy !== me
		);
		// Still there: one deleted since it arrived is not worth saying.
		const items = (await db.items.bulkGet(theirs.map((item) => item.id))).filter(isLive);
		if (!items.length) return;

		await members.refresh(trip.id);
		const adders = new Set(items.map((item) => item.addedBy!));
		const who = adders.size === 1 ? nameOf(items[0].addedBy!, me) : 'Others on the trip';
		const what =
			items.length === 1 ? items[0].description.trim() || 'an item' : `${items.length} items`;
		const first = items[0].id;
		toast.show({
			message: `${who} added ${what}`,
			action: { label: 'Show', run: () => void show(first) }
		});
	}

	function nameOf(addedBy: string, me: string): string {
		const name = describeAdder(members.list, addedBy, me);
		if (name === 'someone who has left') return 'Someone';
		return name.charAt(0).toUpperCase() + name.slice(1);
	}

	/** Goes to the trolley, and brings the item into view, highlighted, with focus on it. */
	async function show(itemId: string) {
		if (page.url.pathname !== resolve('/')) await goto(resolve('/'));
		const row = await rowOf(itemId);
		if (!row) return;
		const still = document.documentElement.dataset.motion === 'reduce';
		row.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
		row.querySelector<HTMLElement>('button.main')?.focus({ preventScroll: true });
		const content = row.querySelector<HTMLElement>('.content') ?? row;
		const from = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft');
		const to = getComputedStyle(content).backgroundColor;
		content.animate(
			[{ backgroundColor: from }, { backgroundColor: from, offset: 0.6 }, { backgroundColor: to }],
			{
				duration: 2000,
				easing: 'ease-out'
			}
		);
	}

	/** The item's row, once the trolley has drawn it; nothing if it never appears. */
	async function rowOf(itemId: string): Promise<HTMLElement | null> {
		const until = Date.now() + 3000;
		for (;;) {
			const row = document.querySelector<HTMLElement>(`[data-item="${CSS.escape(itemId)}"]`);
			if (row || Date.now() > until) return row;
			await new Promise((done) => requestAnimationFrame(done));
		}
	}
</script>
