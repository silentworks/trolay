<script lang="ts">
	import Cart from '#lib/components/Cart.svelte';
	import StartTrip from '#lib/components/StartTrip.svelte';
	import { getOpenTrip } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';

	const openTrip = new LiveQuery(() => getOpenTrip());
</script>

<svelte:head>
	<title>Trolay</title>
</svelte:head>

{#if openTrip.loaded}
	{#if openTrip.current}
		{#key openTrip.current.id}
			<Cart tripId={openTrip.current.id} />
		{/key}
	{:else}
		<StartTrip />
	{/if}
{/if}
