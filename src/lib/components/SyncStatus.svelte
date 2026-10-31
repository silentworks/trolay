<script lang="ts">
	import { syncEngine } from '#lib/sync/engine.svelte.ts';

	const plural = (n: number) => `${n} change${n === 1 ? '' : 's'}`;
	// A big first upload shows how far it has got; a small one is over before it could be read.
	const big = $derived(syncEngine.started > 25);
</script>

{#if syncEngine.status !== 'off'}
	<p class="sync" data-status={syncEngine.status} role="status">
		{#if syncEngine.status === 'syncing'}
			{big ? `Uploading ${syncEngine.sent} of ${syncEngine.started}…` : 'Syncing…'}
		{:else if syncEngine.status === 'offline'}
			Offline. {syncEngine.pending ? `${plural(syncEngine.pending)} will` : 'Changes will'} sync when
			you're back online.
		{:else if syncEngine.status === 'error'}
			Couldn't sync just now. It will try again.
		{:else if syncEngine.status === 'pending' && syncEngine.stuck}
			{plural(syncEngine.pending)} couldn't be sent yet. It will keep trying.
		{:else if syncEngine.status === 'pending'}
			{plural(syncEngine.pending)} waiting to sync.
		{:else}
			✓ Synced
		{/if}
	</p>
{/if}

<style>
	.sync {
		margin: 0 0 12px;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.sync[data-status='synced'] {
		color: var(--accent);
	}

	.sync[data-status='error'] {
		color: var(--danger);
	}
</style>
