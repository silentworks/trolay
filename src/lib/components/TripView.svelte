<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatWhen } from '#lib/dates.ts';
	import type { Item } from '#lib/data/db.ts';
	import { itemName, listTripItems } from '#lib/data/items.ts';
	import { getStore } from '#lib/data/stores.ts';
	import { deleteTrip, deleteTripPhotos, getTrip, receiptDifference } from '#lib/data/trips.ts';
	import { exportTripCsv } from '#lib/export/history.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { formatGBP, lineTotals } from '#lib/money.ts';
	import { tripsSharedWithMe } from '#lib/sharing/ownership.ts';
	import AppHeader, { type MenuEntry } from './AppHeader.svelte';
	import PhotoImage from './PhotoImage.svelte';
	import PhotoViewer from './PhotoViewer.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		tripId: string;
	}

	let { tripId }: Props = $props();

	// A finished trip is read-only: nothing here changes it except deleting its kept photos.
	const view = new LiveQuery(async () => {
		const trip = await getTrip(tripId);
		if (!trip || trip.status !== 'finished') return undefined;
		const [store, items] = await Promise.all([getStore(trip.storeId), listTripItems(tripId)]);
		return { trip, store, items };
	});

	let viewing = $state<Item>();
	let confirming = $state(false);
	let deleting = $state(false);
	let problem = $state('');

	const trip = $derived(view.current?.trip);
	const totals = $derived(trip?.totals);
	const difference = $derived(
		trip && totals ? receiptDifference(trip.receiptTotalMinor, totals.inclMinor) : undefined
	);
	const photoCount = $derived(view.current?.items.filter((item) => item.photoId).length ?? 0);

	const menu = $derived<MenuEntry[]>([
		{ label: 'Export as CSV', onclick: exportCsv },
		{ label: 'Delete this trip', onclick: () => (deleting = true), danger: true }
	]);

	async function exportCsv() {
		problem = '';
		try {
			await exportTripCsv(tripId);
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	}

	async function deleteThisTrip() {
		problem = '';
		try {
			if ((await tripsSharedWithMe([tripId])).size) {
				throw new Error('This trip belongs to whoever invited you, so only they can delete it.');
			}
			await deleteTrip(tripId);
			await goto(resolve('/history'));
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			deleting = false;
		}
	}

	async function deletePhotos() {
		await deleteTripPhotos(tripId);
		confirming = false;
	}
</script>

<svelte:head>
	<title>{view.current?.store?.name ?? 'Trip'} · History · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader
		title={trip && totals ? (view.current?.store?.name ?? 'Deleted store') : 'Trip'}
		subtitle={trip && totals ? view.current?.store?.branch : undefined}
		back={{ href: resolve('/history'), label: 'History' }}
		menu={trip && totals ? menu : undefined}
	/>

	{#if view.loaded && (!trip || !totals)}
		<p class="hint">This trip isn't in your history.</p>
	{:else if trip && totals}
		<p class="when">{trip.finishedAt ? formatWhen(trip.finishedAt) : ''}</p>

		<dl class="sums" aria-label="Trip totals">
			<div class="headline">
				<dt>Total incl. VAT</dt>
				<dd>{formatGBP(totals.inclMinor)}</dd>
			</div>
			<div>
				<dt>Excl. VAT</dt>
				<dd>{formatGBP(totals.exclMinor)}</dd>
			</div>
			<div>
				<dt>VAT</dt>
				<dd>{formatGBP(totals.inclMinor - totals.exclMinor)}</dd>
			</div>
			<div>
				<dt>Items</dt>
				<dd>{totals.itemCount}</dd>
			</div>
			<div>
				<dt>Receipt total</dt>
				<dd>{trip.receiptTotalMinor === undefined ? '—' : formatGBP(trip.receiptTotalMinor)}</dd>
			</div>
		</dl>

		{#if difference !== undefined}
			<p class="difference" data-match={difference === 0}>
				{#if difference === 0}
					✓ The receipt matched.
				{:else}
					The till charged {formatGBP(Math.abs(difference))}
					{difference > 0 ? 'more' : 'less'} than Trolay added up.
				{/if}
			</p>
		{/if}

		{#if photoCount > 0}
			<div class="kept">
				<p>
					The label photos are kept as evidence because the receipt did not match. Tap one to see
					it.
				</p>
				<button class="btn" type="button" onclick={() => (confirming = true)}>Delete photos</button>
			</div>
		{/if}

		{#if problem}<p class="error" role="alert">{problem}</p>{/if}

		<h2>Items</h2>
		<ul class="items" aria-label="Items bought">
			{#each view.current?.items ?? [] as item (item.id)}
				{@const line = lineTotals(item, totals.taxRateBps)}
				{@const name = itemName(item)}
				<li class="item">
					{#if item.photoId}
						<button
							class="thumb"
							type="button"
							aria-label="Photo of {name}"
							onclick={() => (viewing = item)}
						>
							<PhotoImage photoId={item.photoId} size="thumb" alt="" />
						</button>
					{/if}
					<span class="name">{name}</span>
					<span class="line-total"
						>{formatGBP(item.priceIncludesTax ? line.inclMinor : line.exclMinor)}</span
					>
					<span class="meta">
						{item.quantity} × {formatGBP(item.unitPriceMinor)}
						{item.priceIncludesTax ? 'incl. VAT' : 'excl. VAT'}{item.barcode
							? ` · ${item.barcode}`
							: ''}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<PhotoViewer
	photoId={viewing?.photoId}
	title={viewing ? `Photo of ${itemName(viewing)}` : ''}
	onclose={() => (viewing = undefined)}
/>

<Sheet open={confirming} title="Delete photos?" onclose={() => (confirming = false)}>
	<p>
		{photoCount === 1 ? 'The label photo' : `All ${photoCount} label photos`} of this trip will be deleted.
		Descriptions, prices and barcodes stay.
	</p>
	<button class="btn btn-danger btn-block" type="button" onclick={deletePhotos}>
		Delete photos
	</button>
</Sheet>

<Sheet open={deleting} title="Delete this trip?" onclose={() => (deleting = false)}>
	<p>
		This trip and its {totals?.itemCount === 1 ? 'item' : `${totals?.itemCount ?? 0} items`}, with
		any photos, will be deleted from your history. This can't be undone.
	</p>
	<button class="btn btn-danger btn-block" type="button" onclick={deleteThisTrip}>
		Delete trip
	</button>
</Sheet>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	h2 {
		font-size: 1.15rem;
		margin: 20px 0 8px;
	}

	.when,
	.hint {
		margin: 4px 0 12px;
		color: var(--muted);
	}

	.sums {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 12px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
		font-variant-numeric: tabular-nums;
	}

	.sums div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}

	.sums dd {
		margin: 0;
		font-weight: 600;
	}

	.sums .headline {
		font-size: 1.25rem;
		font-weight: 800;
	}

	.sums .headline dd {
		font-weight: 800;
	}

	.difference {
		margin: 12px 0 0;
		font-weight: 700;
		color: var(--warning-text);
	}

	.difference[data-match='true'] {
		color: var(--accent);
	}

	.kept {
		display: grid;
		gap: 8px;
		margin-top: 12px;
		padding: 12px;
		border-radius: var(--radius);
		background: var(--warning-bg);
		color: var(--warning-text);
	}

	.kept p {
		margin: 0;
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.item {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 2px 12px;
		align-items: center;
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--border);
	}

	.thumb {
		grid-row: span 2;
		width: 56px;
		height: 56px;
		padding: 0;
		border: none;
		border-radius: 8px;
		overflow: hidden;
		background: var(--surface-2);
	}

	.thumb :global(img) {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.name {
		grid-column: 2;
		font-weight: 700;
	}

	.line-total {
		grid-column: 3;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.meta {
		grid-column: 2 / 4;
		color: var(--muted);
		font-size: 0.9rem;
		font-variant-numeric: tabular-nums;
	}
</style>
