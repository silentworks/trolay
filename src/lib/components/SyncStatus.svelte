<script lang="ts">
	import { syncMessage } from '#lib/sync/message.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
</script>

<!-- A line of text, so it can sit under a settings row's label. -->
{#if syncEngine.status !== 'off'}
	<span class="sync" data-status={syncEngine.status} role="status">{syncMessage(syncEngine)}</span>
{/if}

<style>
	.sync {
		display: block;
	}

	.sync[data-status='synced'] {
		color: var(--accent);
	}

	.sync[data-status='error'] {
		color: var(--danger);
	}
</style>
