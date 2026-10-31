<script lang="ts">
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import BackupPanel from '#lib/components/BackupPanel.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import { formatWhen } from '#lib/dates.ts';
	import { deleteTrip, listFinishedTrips, receiptDifference } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { exportHistoryCsv } from '#lib/export/history.ts';
	import { formatGBP } from '#lib/money.ts';
	import { tripsSharedWithMe } from '#lib/sharing/ownership.ts';

	const history = new LiveQuery(() => listFinishedTrips());
	let problem = $state('');
	let clearing = $state(false);
	let note = $state('');

	async function exportAll() {
		problem = '';
		try {
			await exportHistoryCsv();
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	}

	/** Clears the history of the trips that are this account's own; a partner's are left. */
	async function clearAll() {
		problem = '';
		note = '';
		try {
			const ids = (history.current ?? []).map(({ trip }) => trip.id);
			const theirs = await tripsSharedWithMe(ids);
			for (const id of ids) if (!theirs.has(id)) await deleteTrip(id);
			if (theirs.size) {
				note = `${theirs.size} shared with you by someone else stay${theirs.size === 1 ? 's' : ''}: only the owner can delete ${theirs.size === 1 ? 'it' : 'them'}.`;
			}
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			clearing = false;
		}
	}
</script>

<svelte:head>
	<title>History · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="History" back={{ href: resolve('/'), label: 'Trolley' }} />

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
			<button
				class="btn btn-danger btn-block export"
				type="button"
				onclick={() => (clearing = true)}
			>
				Delete all history
			</button>
			{#if problem}<p class="error" role="alert">{problem}</p>{/if}
		{:else}
			<p class="hint">No finished trips yet. Finish a trip and it appears here.</p>
		{/if}
	{/if}

	{#if note}<p class="hint" role="status">{note}</p>{/if}

	<BackupPanel />
</div>

<Sheet open={clearing} title="Delete all history?" onclose={() => (clearing = false)}>
	<p>
		Every finished trip, with its items and photos, will be deleted. Your stores stay. This can't be
		undone: export a CSV first if you want to keep a copy.
	</p>
	<button class="btn btn-danger btn-block" type="button" onclick={clearAll}>
		Delete all history
	</button>
</Sheet>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
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
