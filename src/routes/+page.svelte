<script lang="ts">
	import Cart from '#lib/components/Cart.svelte';
	import Onboarding from '#lib/components/Onboarding.svelte';
	import StartTrip from '#lib/components/StartTrip.svelte';
	import { db } from '#lib/data/db.ts';
	import { getOpenTrip } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';

	const openTrip = new LiveQuery(() => getOpenTrip());
	// A phone that has never had a store or a trip, deleted ones included. Stores synced from an
	// account or restored from a backup count, so those phones skip the guide.
	const fresh = new LiveQuery(
		async () => (await db.stores.count()) + (await db.trips.count()) === 0
	);
	let notice = $state<string>();

	function finished(photosKept: boolean) {
		notice = photosKept
			? 'Trip saved. Its photos are kept because the receipt did not match.'
			: 'Trip saved.';
	}

	function left(message?: string) {
		notice = message ?? 'You left the store. Nothing was saved.';
	}

	$effect(() => {
		if (fresh.loaded && !fresh.current && !settings.onboarded) settings.markOnboarded();
	});

	// The owner took this phone off a shared trip: its copy has been let go of.
	$effect(() => {
		const store = syncEngine.removedFrom;
		if (store === undefined) return;
		notice = `You are no longer on the trip${store ? ` at ${store}` : ''}. The person who invited you ended it.`;
		syncEngine.removedFrom = undefined;
	});
</script>

<svelte:head>
	<title>Trolay</title>
</svelte:head>

{#if openTrip.loaded && fresh.loaded}
	{#if fresh.current && !settings.onboarded}
		<Onboarding ondone={() => settings.markOnboarded()} />
	{:else if openTrip.current}
		{#key openTrip.current.id}
			<Cart tripId={openTrip.current.id} onfinished={finished} onleft={left} />
		{/key}
	{:else}
		<StartTrip {notice} />
	{/if}
{/if}
