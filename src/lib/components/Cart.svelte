<script lang="ts">
	import { resolve } from '$app/paths';
	import { warmUpBarcodes } from '#lib/capture/barcode.ts';
	import { warmUpOcr } from '#lib/capture/ocr/browser.ts';
	import { compressPhoto } from '#lib/capture/image.ts';
	import { CaptureSession } from '#lib/capture/session.svelte.ts';
	import { db, type ExtractedFields, type Item, type Store } from '#lib/data/db.ts';
	import {
		addItem,
		deleteItem,
		itemName,
		listTripItems,
		restoreItem,
		revertItem,
		setItemPhoto,
		setQuantity,
		updateItem,
		type ItemInput
	} from '#lib/data/items.ts';
	import { getStore, listStores } from '#lib/data/stores.ts';
	import { changeTripStore, finishTrip, setReceiptTotal, setTripBudget } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { tripTotals } from '#lib/money.ts';
	import BudgetForm from './BudgetForm.svelte';
	import CameraCapture from './CameraCapture.svelte';
	import FinishTrip from './FinishTrip.svelte';
	import ItemForm from './ItemForm.svelte';
	import ItemRow from './ItemRow.svelte';
	import PhotoViewer from './PhotoViewer.svelte';
	import Sheet from './Sheet.svelte';
	import StoreList from './StoreList.svelte';
	import Toast from './Toast.svelte';
	import TotalsFooter from './TotalsFooter.svelte';

	interface Props {
		tripId: string;
		/** The trip has moved to History; this cart is about to close. */
		onfinished?: (photosKept: boolean) => void;
	}

	let { tripId, onfinished }: Props = $props();

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
		| { kind: 'add'; capture?: CaptureSession }
		| { kind: 'edit'; item: Item }
		| { kind: 'budget' }
		| { kind: 'store' }
		| { kind: 'finish' };
	let sheet = $state<SheetState | null>(null);
	let camera = $state(false);
	let viewing = $state<Item>();
	let toast = $state<{ id: number; message: string; undoItemId?: string } | null>(null);
	let toastCount = 0;

	const trip = $derived(cart.current?.trip);
	const store = $derived(cart.current?.store);
	const items = $derived(cart.current?.items ?? []);
	const totals = $derived(tripTotals(items, store?.taxRateBps ?? 0));
	const photoCount = $derived(items.filter((item) => item.photoId).length);

	// Load the label and barcode readers while the shopper picks up the first item, so the
	// first capture is quick. Failures surface on first use instead.
	$effect(() => {
		const timer = setTimeout(() => {
			warmUpOcr().catch(() => {});
			warmUpBarcodes().catch(() => {});
		}, 1000);
		return () => clearTimeout(timer);
	});

	// A capture's photo preview is released when its sheet closes.
	$effect(() => {
		const capture = sheet?.kind === 'add' ? sheet.capture : undefined;
		return () => capture?.dispose();
	});

	function captured(photo: Blob, barcode: string | undefined) {
		camera = false;
		sheet = { kind: 'add', capture: new CaptureSession(photo, barcode) };
	}

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

	async function saveNew(
		input: ItemInput,
		extracted: ExtractedFields | undefined,
		capture: CaptureSession | undefined
	) {
		// The photo is usually compressed by now; if it failed, the item is saved without it.
		const photo = capture && (await capture.ready.catch(() => undefined));
		await addItem(tripId, input, { photo, extracted });
		sheet = null;
	}

	async function saveEdit(item: Item, input: ItemInput) {
		await updateItem(item.id, input);
		sheet = null;
	}

	/** Retake from the edit sheet; the sheet stays open on the updated item. */
	async function retake(item: Item, source: Blob) {
		await setItemPhoto(item.id, await compressPhoto(source));
		const updated = await db.items.get(item.id);
		if (updated && sheet?.kind === 'edit') sheet = { kind: 'edit', item: updated };
		show('Photo updated');
	}

	function remove(item: Item) {
		sheet = null;
		run(async () => {
			await deleteItem(item.id);
			show(`Deleted ${itemName(item)}`, item.id);
		});
	}

	function undo(itemId: string) {
		toast = null;
		run(() => restoreItem(itemId));
	}

	let menuOpen = $state(false);

	function tapStoreName() {
		if (items.length > 0) show('The store can only be changed while the cart is empty.');
		else sheet = { kind: 'store' };
	}

	async function pickStore(next: Store) {
		sheet = null;
		await run(() => changeTripStore(tripId, next.id));
	}

	function tapFinish() {
		if (items.length === 0) show('Add an item before finishing the trip.');
		else sheet = { kind: 'finish' };
	}

	async function finish() {
		const { photosKept } = await finishTrip(tripId);
		sheet = null;
		onfinished?.(photosKept);
	}

	async function saveBudget(budgetMinor: number | undefined) {
		await run(() => setTripBudget(tripId, budgetMinor));
		sheet = null;
	}
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (menuOpen = false)} />

{#if trip && store}
	<div class="page">
		<header class="bar">
			<button class="store" type="button" onclick={tapStoreName} aria-label="Store: {store.name}">
				<span class="name">{store.name}</span>
				{#if store.branch}<span class="branch">{store.branch}</span>{/if}
			</button>
			<button
				class="round more"
				type="button"
				aria-label="Menu"
				aria-expanded={menuOpen}
				aria-controls="cart-menu"
				onclick={() => (menuOpen = !menuOpen)}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="5" r="1.8" />
					<circle cx="12" cy="12" r="1.8" />
					<circle cx="12" cy="19" r="1.8" />
				</svg>
			</button>
			{#if menuOpen}
				<!-- Covers the page so a tap anywhere outside the menu closes it. -->
				<div class="scrim" aria-hidden="true" onclick={() => (menuOpen = false)}></div>
				<nav id="cart-menu" class="menu" aria-label="Menu">
					<a href={resolve('/history')}>History</a>
					<a href={resolve('/stores')}>Stores</a>
					<button
						type="button"
						onclick={() => {
							menuOpen = false;
							tapFinish();
						}}
					>
						Finish trip
					</button>
				</nav>
			{/if}
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
						onphoto={() => (viewing = item)}
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
			<div class="actions">
				<button class="snap" type="button" aria-label="Snap label" onclick={() => (camera = true)}>
					<svg viewBox="0 0 64 64" aria-hidden="true">
						<circle class="lens" cx="31" cy="34" r="13" />
						<circle class="flash" cx="47" cy="17" r="5" />
					</svg>
				</button>
				<button class="manual" type="button" onclick={() => (sheet = { kind: 'add' })}>
					Add by hand
				</button>
			</div>
			<TotalsFooter
				{totals}
				budgetMinor={trip.budgetMinor}
				onbudget={() => (sheet = { kind: 'budget' })}
			/>
		</div>
	</div>

	<CameraCapture open={camera} mode="label" oncapture={captured} onclose={() => (camera = false)} />

	<Sheet
		open={sheet?.kind === 'add'}
		title={sheet?.kind === 'add' && sheet.capture ? 'Check the label' : 'Add item'}
		onclose={() => (sheet = null)}
	>
		{#if sheet?.kind === 'add'}
			{@const capture = sheet.capture}
			<ItemForm
				{capture}
				storeId={store.id}
				defaultIncludesTax={store.pricesIncludeTax}
				taxRateBps={store.taxRateBps}
				onsave={(input, extracted) => saveNew(input, extracted, capture)}
			/>
		{/if}
	</Sheet>

	<Sheet open={sheet?.kind === 'edit'} title="Edit item" onclose={() => (sheet = null)}>
		{#if sheet?.kind === 'edit'}
			{@const item = sheet.item}
			<ItemForm
				{item}
				storeId={store.id}
				defaultIncludesTax={store.pricesIncludeTax}
				taxRateBps={store.taxRateBps}
				onsave={(input) => saveEdit(item, input)}
				ondelete={() => remove(item)}
				onrevert={async () => {
					await revertItem(item.id);
					sheet = null;
				}}
				onretake={(photo) => retake(item, photo)}
			/>
		{/if}
	</Sheet>

	<PhotoViewer
		photoId={viewing?.photoId}
		title={viewing ? `Photo of ${itemName(viewing)}` : ''}
		onclose={() => (viewing = undefined)}
	/>

	<Sheet open={sheet?.kind === 'budget'} title="Trip budget" onclose={() => (sheet = null)}>
		<BudgetForm budgetMinor={trip.budgetMinor} onsave={saveBudget} />
	</Sheet>

	<Sheet open={sheet?.kind === 'finish'} title="Finish trip" onclose={() => (sheet = null)}>
		<FinishTrip
			appTotalMinor={totals.inclMinor}
			receiptTotalMinor={trip.receiptTotalMinor}
			{photoCount}
			onreceipt={(minor) => setReceiptTotal(tripId, minor)}
			onfinish={() => run(finish)}
		/>
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

	/*
	 * The header sits on its own surface, edge to edge. The menu button has an empty column of the
	 * same width opposite it, so the store name is centred on the screen.
	 */
	.bar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: grid;
		grid-template-columns: var(--tap) minmax(0, 1fr) var(--tap);
		grid-template-areas: '. store more';
		align-items: center;
		gap: 8px;
		margin: 0 calc(-1 * var(--gutter)) 12px;
		padding: calc(8px + env(safe-area-inset-top)) var(--gutter) 8px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.06);
	}

	.store {
		grid-area: store;
		min-width: 0;
		display: grid;
		justify-items: center;
		align-content: center;
		min-height: var(--tap);
		padding: 0;
		border: none;
		background: transparent;
		text-align: center;
		overflow-wrap: break-word;
	}

	.store .name {
		max-width: 100%;
		font-weight: 800;
		font-size: 1.2rem;
		line-height: 1.2;
	}

	.store .branch {
		max-width: 100%;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.round {
		grid-area: more;
		display: grid;
		place-items: center;
		width: var(--tap);
		height: var(--tap);
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--surface-2);
	}

	.round svg {
		width: 22px;
		height: 22px;
		fill: currentColor;
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 2;
	}

	/* A small panel under the menu button, lined up with the right edge of the page. */
	.menu {
		position: fixed;
		z-index: 3;
		top: calc(env(safe-area-inset-top) + 60px);
		right: max(var(--gutter), (100vw - 560px) / 2 + var(--gutter));
		display: grid;
		width: max-content;
		min-width: 12rem;
		max-width: calc(100vw - 2 * var(--gutter));
		padding: 6px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
	}

	.menu a,
	.menu button {
		display: flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 14px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text);
		font-weight: 600;
		text-align: left;
		text-decoration: none;
	}

	.menu a:hover,
	.menu button:hover {
		background: var(--surface-2);
	}

	.menu button {
		margin-top: 4px;
		border-top: 1px solid var(--border);
		border-radius: 0 0 8px 8px;
		color: var(--accent);
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

	/* The camera button in the middle, with adding by hand offered to its right. */
	.actions {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 12px;
	}

	.snap {
		grid-column: 2;
		display: grid;
		place-items: center;
		width: 72px;
		height: 72px;
		padding: 0;
		border: 1px solid rgb(255 255 255 / 0.08);
		border-radius: 22px;
		background: linear-gradient(160deg, #1d1b2b, #2a2640);
		box-shadow: 0 6px 16px rgb(0 0 0 / 0.25);
	}

	.snap:active {
		transform: scale(0.96);
	}

	.snap svg {
		width: 56px;
		height: 56px;
	}

	.snap .lens {
		fill: none;
		stroke: #fdc79a;
		stroke-width: 7;
	}

	.snap .flash {
		fill: #c9c3ff;
	}

	.manual {
		justify-self: start;
		min-height: var(--tap);
		padding: 0 4px;
		border: none;
		background: transparent;
		color: var(--accent);
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
</style>
