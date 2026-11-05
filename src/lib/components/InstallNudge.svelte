<script lang="ts">
	import { install } from '#lib/install.svelte.ts';
	import { appUpdate } from '#lib/update.svelte.ts';
	import Banner from './Banner.svelte';

	// A few seconds in, so it doesn't greet the shopper before the app has.
	const DELAY_MS = 4000;

	// Safari can clear data for sites that are not on the Home Screen after 7 days without a
	// visit, so installing keeps the trolley safe as well as one tap away.
	let ready = $state(false);
	$effect(() => {
		const timer = setTimeout(() => (ready = true), DELAY_MS);
		return () => clearTimeout(timer);
	});
</script>

{#if ready && install.offered && !appUpdate.available}
	<Banner label="Install the app">
		{#snippet icon()}
			<svg viewBox="0 0 24 24">
				<rect x="6" y="2.5" width="12" height="19" rx="2.5" />
				<path d="M12 7v7m-3-3 3 3 3-3M10.5 18.5h3" />
			</svg>
		{/snippet}
		{#if install.canPrompt}
			Install Trolay for quick access!
		{:else}
			Install Trolay for quick access: tap <span aria-label="the Share button">Share</span>, then
			<em>Add to Home Screen</em>.
		{/if}
		{#snippet actions()}
			{#if install.canPrompt}
				<button class="btn btn-primary" type="button" onclick={() => install.prompt()}
					>Install</button
				>
				<button class="btn btn-ghost" type="button" onclick={() => install.later()}>Later</button>
			{:else}
				<button class="btn" type="button" onclick={() => install.later()}>Got it</button>
			{/if}
		{/snippet}
	</Banner>
{/if}
