<script lang="ts">
	import { syncMessage } from '#lib/sync/message.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
</script>

{#if syncEngine.status !== 'off'}
	<p class="sync" data-status={syncEngine.status} role="status">{syncMessage(syncEngine)}</p>
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
