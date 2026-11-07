<script lang="ts">
	import { version } from '$app/env';
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { formatWhen } from '#lib/dates.ts';

	// SvelteKit names each build by the time it was made, so the version reads as a date too.
	const built = /^\d+$/.test(version) ? formatWhen(Number(version)) : undefined;
</script>

<svelte:head>
	<title>About · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="About Trolay" back={{ href: resolve('/settings'), label: 'Settings' }} />

	<dl class="card">
		<div>
			<dt>Version</dt>
			<dd>{version}</dd>
		</div>
		{#if built}
			<div>
				<dt>Built</dt>
				<dd>{built}</dd>
			</div>
		{/if}
	</dl>

	<p>
		Your stores, trips and items are kept on this phone. When you're signed in, they also sync
		between your own devices.
	</p>
	<a class="btn btn-block" href={resolve('/welcome')}>Show the getting started guide</a>
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.card {
		margin: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.card div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		min-height: var(--tap);
		align-items: center;
		padding: 0 16px;
	}

	.card div + div {
		border-top: 1px solid var(--border);
	}

	dt {
		font-weight: 600;
	}

	dd {
		margin: 0;
		color: var(--muted);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
