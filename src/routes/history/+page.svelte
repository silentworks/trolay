<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatWhen } from '#lib/dates.ts';
	import { listFinishedTrips, receiptDifference } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { exportHistoryCsv } from '#lib/export/history.ts';
	import { formatGBP } from '#lib/money.ts';

	const history = new LiveQuery(() => listFinishedTrips());
	let problem = $state('');

	async function exportAll() {
		problem = '';
		try {
			await exportHistoryCsv();
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	}
</script>

<svelte:head>
	<title>History · Trolay</title>
</svelte:head>

<div class="page">
	<header>
		<a class="btn btn-ghost" href={resolve('/')}>← Trolley</a>
		<h1>History</h1>
	</header>

	{#if history.loaded}
		{#if history.current?.length}
			<ul class="trips" aria-label="Past trips">
				{#each history.current as { trip, store } (trip.id)}
					{@const difference = receiptDifference(
						trip.receiptTotalMinor,
						trip.totals?.inclMinor ?? 0
					)}
					<li>
						<a class="trip" href={resolve('/history/[id]', { id: trip.id })}>
							<span class="store">
								{store?.name ?? 'Deleted store'}{store?.branch ? ` · ${store.branch}` : ''}
							</span>
							<span class="total">{formatGBP(trip.totals?.inclMinor ?? 0)}</span>
							<span class="when">
								{trip.finishedAt ? formatWhen(trip.finishedAt) : ''} ·
								{trip.totals?.itemCount ?? 0}
								{trip.totals?.itemCount === 1 ? 'item' : 'items'}
							</span>
							<span
								class="receipt"
								data-tone={difference === undefined ? 'none' : difference === 0 ? 'ok' : 'off'}
							>
								{#if difference === undefined}
									No receipt total
								{:else if difference === 0}
									✓ Receipt matched
								{:else}
									Receipt {difference > 0 ? '+' : '−'}{formatGBP(Math.abs(difference))}
								{/if}
							</span>
							{#if trip.photosKept}<span class="badge">Photos kept</span>{/if}
						</a>
					</li>
				{/each}
			</ul>
			<button class="btn btn-block export" type="button" onclick={exportAll}>
				Export all history as CSV
			</button>
			{#if problem}<p class="error" role="alert">{problem}</p>{/if}
		{:else}
			<p class="hint">No finished trips yet. Finish a trip and it appears here.</p>
		{/if}
	{/if}
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: var(--gutter);
	}

	header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 12px;
	}

	h1 {
		font-size: 1.5rem;
	}

	.hint {
		color: var(--muted);
	}

	.export {
		margin-top: 16px;
	}

	.trips {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.trip {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 12px;
		align-items: baseline;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		color: inherit;
		text-decoration: none;
	}

	.store {
		font-weight: 800;
		font-size: 1.1rem;
	}

	.total {
		font-weight: 800;
		font-size: 1.1rem;
		font-variant-numeric: tabular-nums;
	}

	.when {
		grid-column: 1 / -1;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.receipt {
		font-size: 0.9rem;
		font-weight: 600;
	}

	.receipt[data-tone='ok'] {
		color: var(--accent);
	}

	.receipt[data-tone='off'] {
		color: var(--warning-text);
	}

	.receipt[data-tone='none'] {
		color: var(--muted);
		font-weight: normal;
	}

	.badge {
		justify-self: end;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--warning-bg);
		color: var(--warning-text);
		font-size: 0.8rem;
		font-weight: 700;
	}
</style>
