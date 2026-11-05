<script lang="ts">
	import { appUpdate } from '#lib/update.svelte.ts';
	import Banner from './Banner.svelte';

	$effect(() => appUpdate.watch());
</script>

{#if appUpdate.available}
	<Banner label="App update">
		{#snippet icon()}
			<svg viewBox="0 0 24 24">
				<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" />
			</svg>
		{/snippet}
		A new version of Trolay is ready.
		{#snippet actions()}
			<button class="btn btn-primary" type="button" onclick={() => appUpdate.apply()}>
				Refresh to update
			</button>
			<button class="btn btn-ghost" type="button" onclick={() => appUpdate.dismiss()}>Later</button>
		{/snippet}
	</Banner>
{/if}
