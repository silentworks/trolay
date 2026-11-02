<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Onboarding from '#lib/components/Onboarding.svelte';
	import { getOpenTrip } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';

	// The getting started guide, opened again from Account. With a trip open it only explains;
	// otherwise finishing it adds a store and starts a trip, as on first run.
	const openTrip = new LiveQuery(() => getOpenTrip());
</script>

<svelte:head>
	<title>Getting started · Trolay</title>
</svelte:head>

{#if openTrip.loaded}
	<Onboarding explainOnly={!!openTrip.current} ondone={() => goto(resolve('/'))} />
{/if}
