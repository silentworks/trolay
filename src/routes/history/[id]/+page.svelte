<script lang="ts">
	import { page } from '$app/state';
	import TripView from '#lib/components/TripView.svelte';
</script>

{#key page.params.id}
	<TripView tripId={page.params.id ?? ''} />
{/key}
