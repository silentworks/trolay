<script lang="ts">
	import { version } from '$app/env';
	import { resolve } from '$app/paths';
	import { shortVersion } from '#lib/changelog.ts';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { formatWhen } from '#lib/dates.ts';

	// The version reads as a date: shown short (2026.11.07), with the full build number under it.
	const short = shortVersion(version);
	const built = short !== version ? formatWhen(Number(version)) : undefined;
</script>

<svelte:head>
	<title>About · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="About Trolay" back={{ href: resolve('/settings'), label: 'Settings' }} />

	<dl class="card">
		<div>
			<dt>Version</dt>
			<dd>
				{short}
				{#if short !== version}<span class="build">{version}</span>{/if}
			</dd>
		</div>
		{#if built}
			<div>
				<dt>Built</dt>
				<dd>{built}</dd>
			</div>
		{/if}
	</dl>

	<a class="news" href={resolve('/settings/about/changelog')}>
		What's new
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
	</a>

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
		padding: 8px 16px;
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

	.news {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: var(--tap);
		margin-top: 12px;
		padding: 8px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: inherit;
		font-weight: 600;
		text-decoration: none;
	}

	.news svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: var(--muted);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.build {
		display: block;
		font-size: 0.78rem;
	}
</style>
