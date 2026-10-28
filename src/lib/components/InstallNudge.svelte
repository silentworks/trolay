<script lang="ts">
	import { settings } from '#lib/settings.svelte.ts';

	// Safari can clear data for sites that are not on the Home Screen after 7 days without a
	// visit, so iOS users get a one-time prompt to install the app.
	const isIos =
		/iphone|ipad|ipod/i.test(navigator.userAgent) ||
		(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
	const isInstalled =
		matchMedia('(display-mode: standalone)').matches ||
		(navigator as Navigator & { standalone?: boolean }).standalone === true;
</script>

{#if isIos && !isInstalled && !settings.installNudgeDismissed}
	<aside class="nudge" aria-label="Install the app">
		<p>
			<strong>Install Shopping Trolley</strong> so your trolley stays saved: tap
			<span aria-label="the Share button">Share</span>, then <em>Add to Home Screen</em>.
		</p>
		<button class="btn" type="button" onclick={() => settings.dismissInstallNudge()}>Got it</button>
	</aside>
{/if}

<style>
	.nudge {
		display: flex;
		align-items: center;
		gap: 12px;
		max-width: 560px;
		margin: calc(8px + env(safe-area-inset-top)) auto 0;
		padding: 12px var(--gutter);
		background: var(--surface-2);
		border-radius: var(--radius);
	}

	.nudge p {
		margin: 0;
		flex: 1;
	}
</style>
