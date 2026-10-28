<script lang="ts">
	import { appUpdate } from '#lib/update.svelte.ts';

	$effect(() => appUpdate.watch());
</script>

{#if appUpdate.available}
	<aside class="update" aria-label="App update">
		<p role="status">A new version of Trolay is ready.</p>
		<button class="btn btn-primary" type="button" onclick={() => appUpdate.apply()}>
			Refresh to update
		</button>
		<button class="btn btn-ghost" type="button" onclick={() => appUpdate.dismiss()}>Later</button>
	</aside>
{/if}

<style>
	.update {
		position: fixed;
		inset: calc(8px + env(safe-area-inset-top)) var(--gutter) auto;
		z-index: 10;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		max-width: 528px;
		margin: 0 auto;
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--text);
		color: var(--bg);
		box-shadow: var(--shadow);
	}

	.update p {
		flex: 1 1 100%;
		margin: 0;
		font-weight: 700;
	}

	.update .btn-ghost {
		color: var(--bg);
	}
</style>
