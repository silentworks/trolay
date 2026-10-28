<script lang="ts">
	import { resolve } from '$app/paths';
	import { db, type Item, type Store } from '#lib/data/db.ts';
	import {
		addItem,
		deleteItem,
		listTripItems,
		restoreItem,
		revertItem,
		setQuantity,
		updateItem,
		type ItemInput
	} from '#lib/data/items.ts';
	import { getStore, listStores } from '#lib/data/stores.ts';
	import { changeTripStore, setTripBudget } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { tripTotals } from '#lib/money.ts';
	import BudgetForm from './BudgetForm.svelte';
	import ItemForm from './ItemForm.svelte';
	import ItemRow from './ItemRow.svelte';
	import Sheet from './Sheet.svelte';
	import StoreList from './StoreList.svelte';
	import Toast from './Toast.svelte';
	import TotalsFooter from './TotalsFooter.svelte';

	interface Props {
		tripId: string;
	}

	let { tripId }: Props = $props();

	// One live query for everything the cart shows; it re-runs when the trip, its store or
	// its items change.
	const cart = new LiveQuery(async () => {
		const trip = await db.trips.get(tripId);
		if (!trip) return undefined;
		const [store, items] = await Promise.all([getStore(trip.storeId), listTripItems(tripId)]);
		return { trip, store, items };
	});
	const stores = new LiveQuery(() => listStores());

	type SheetState =
		{ kind: 'add' } | { kind: 'edit'; item: Item } | { kind: 'budget' } | { kind: 'store' };
	let sheet = $state<SheetState | null>(null);
	let toast = $state<{ id: number; message: string; undoItemId?: string } | null>(null);
	let toastCount = 0;

	const trip = $derived(cart.current?.trip);
	const store = $derived(cart.current?.store);
	const items = $derived(cart.current?.items ?? []);
	const totals = $derived(tripTotals(items, store?.taxRateBps ?? 0));

	function show(message: string, undoItemId?: string) {
		toast = { id: ++toastCount, message, undoItemId };
	}

	async function run(action: () => Promise<void>) {
		try {
			await action();
		} catch (e) {
			show(e instanceof Error ? e.message : String(e));
		}
	}

	async function saveNew(input: ItemInput) {
		await addItem(tripId, input);
		sheet = null;
	}

	async function saveEdit(item: Item, input: ItemInput) {
		await updateItem(item.id, input);
		sheet = null;
	}

	function remove(item: Item) {
		sheet = null;
		run(async () => {
			await deleteItem(item.id);
			show(`Deleted ${item.description}`, item.id);
		});
	}

	function undo(itemId: string) {
		toast = null;
		run(() => restoreItem(itemId));
	}

	function tapStoreName() {
		if (items.length > 0) show('The store can only be changed while the cart is empty.');
		else sheet = { kind: 'store' };
	}

	async function pickStore(next: Store) {
		sheet = null;
		await run(() => changeTripStore(tripId, next.id));
	}

	async function saveBudget(budgetMinor: number | undefined) {
		await run(() => setTripBudget(tripId, budgetMinor));
		sheet = null;
	}
</script>

{#if trip && store}
	<div class="page">
		<header class="bar">
			<button class="store" type="button" onclick={tapStoreName} aria-label="Store: {store.name}">
				<span class="label">Shopping at</span>
				<span class="name">{store.name}{store.branch ? ` · ${store.branch}` : ''}</span>
			</button>
			<a class="btn btn-ghost" href={resolve('/stores')}>Stores</a>
		</header>

		{#if items.length}
			<ul class="items" aria-label="Items in your trolley">
				{#each items as item (item.id)}
					<ItemRow
						{item}
						taxRateBps={store.taxRateBps}
						onedit={() => (sheet = { kind: 'edit', item })}
						ondelete={() => remove(item)}
						onquantity={(quantity) => run(() => setQuantity(item.id, quantity))}
					/>
				{/each}
			</ul>
		{:else}
			<div class="empty">
				<p class="big">Your trolley is empty.</p>
				<p>Add the first item to start the running total.</p>
			</div>
		{/if}

		<div class="dock">
			{#if toast}
				{#key toast.id}
					<Toast
						message={toast.message}
						actionLabel={toast.undoItemId ? 'Undo' : undefined}
						onaction={toast.undoItemId ? () => undo(toast!.undoItemId!) : undefined}
						ondismiss={() => (toast = null)}
					/>
				{/key}
			{/if}
			<button
				class="btn btn-primary btn-block add"
				type="button"
				onclick={() => (sheet = { kind: 'add' })}
			>
				+ Add item
			</button>
			<TotalsFooter
				{totals}
				budgetMinor={trip.budgetMinor}
				onbudget={() => (sheet = { kind: 'budget' })}
			/>
		</div>
	</div>

	<Sheet open={sheet?.kind === 'add'} title="Add item" onclose={() => (sheet = null)}>
		<ItemForm
			defaultIncludesTax={store.pricesIncludeTax}
			taxRateBps={store.taxRateBps}
			onsave={saveNew}
		/>
	</Sheet>

	<Sheet open={sheet?.kind === 'edit'} title="Edit item" onclose={() => (sheet = null)}>
		{#if sheet?.kind === 'edit'}
			{@const item = sheet.item}
			<ItemForm
				{item}
				defaultIncludesTax={store.pricesIncludeTax}
				taxRateBps={store.taxRateBps}
				onsave={(input) => saveEdit(item, input)}
				ondelete={() => remove(item)}
				onrevert={async () => {
					await revertItem(item.id);
					sheet = null;
				}}
			/>
		{/if}
	</Sheet>

	<Sheet open={sheet?.kind === 'budget'} title="Trip budget" onclose={() => (sheet = null)}>
		<BudgetForm budgetMinor={trip.budgetMinor} onsave={saveBudget} />
	</Sheet>

	<Sheet open={sheet?.kind === 'store'} title="Change store" onclose={() => (sheet = null)}>
		<StoreList stores={stores.current ?? []} currentId={store.id} onpick={pickStore} />
	</Sheet>
{/if}

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter);
		/* Leaves room for the dock so the last item can scroll above it. */
		padding-bottom: calc(260px + env(safe-area-inset-bottom));
	}

	.bar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: calc(8px + env(safe-area-inset-top)) 0 8px;
		background: var(--bg);
	}

	.store {
		display: grid;
		justify-items: start;
		min-height: var(--tap);
		padding: 0;
		border: none;
		background: transparent;
		text-align: left;
	}

	.store .label {
		color: var(--muted);
		font-size: 0.85rem;
	}

	.store .name {
		font-weight: 800;
		font-size: 1.3rem;
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	.empty {
		text-align: center;
		color: var(--muted);
		padding: 48px 0;
	}

	.empty .big {
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--text);
	}

	/* Primary action and totals in the bottom third, always visible. */
	.dock {
		position: fixed;
		inset: auto 0 0;
		display: grid;
		gap: 8px;
		max-width: 560px;
		margin: 0 auto;
		padding: 12px var(--gutter) calc(12px + env(safe-area-inset-bottom));
		background: var(--bg);
		box-shadow: var(--shadow);
	}

	.add {
		min-height: 56px;
		font-size: 1.1rem;
	}
</style>
