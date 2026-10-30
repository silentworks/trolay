<script lang="ts">
	import Cart from '#lib/components/Cart.svelte';
	import StartTrip from '#lib/components/StartTrip.svelte';
	import { getOpenTrip } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';

	const openTrip = new LiveQuery(() => getOpenTrip());
	let notice = $state<string>();

	function finished(photosKept: boolean) {
		notice = photosKept
			? 'Trip saved. Its photos are kept because the receipt did not match.'
			: 'Trip saved.';
	}

	function left() {
		notice = 'You left the store. Nothing was saved.';
	}
</script>

<svelte:head>
	<title>Trolay</title>
</svelte:head>

{#if openTrip.loaded}
	{#if openTrip.current}
		{#key openTrip.current.id}
			<Cart tripId={openTrip.current.id} onfinished={finished} onleft={left} />
		{/key}
	{:else}
		<StartTrip {notice} />
	{/if}
{/if}
