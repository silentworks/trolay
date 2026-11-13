<script lang="ts">
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';

	// Offline, nothing syncs, so this takes the sync icon's place beside the title (AppHeader).
	function explain() {
		toast.show({
			message:
				// Off when signed out, or when this phone wasn't signed in last time it could ask.
				syncEngine.status === 'off'
					? "You're offline. Trolay keeps working on this phone."
					: "You're offline. Trolay keeps working, and changes sync when you're back online."
		});
	}
</script>

<button class="offline" type="button" aria-label="Offline" onclick={explain}>
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path d="M7 18h10.5a4 4 0 0 0 1.2-7.8 6 6 0 0 0-10.6-3" />
		<path d="M5.6 9.2A4.5 4.5 0 0 0 7 18" />
		<path d="m3 3 18 18" />
	</svg>
</button>

<style>
	/* The sync icon's slot and size: 36px wide, the tap reaching 4px either side, to 44px. */
	.offline {
		position: relative;
		display: grid;
		place-items: center;
		width: 36px;
		height: var(--tap);
		padding: 0;
		border: none;
		background: transparent;
		/* Amber, readable on the page in either theme. */
		color: var(--warning-text);
	}

	.offline::before {
		content: '';
		position: absolute;
		inset: 0 -4px;
	}

	svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
