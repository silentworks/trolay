<script lang="ts">
	import { resolve } from '$app/paths';
	import { warmUpBarcodes } from '#lib/capture/barcode.ts';
	import { warmUpOcr } from '#lib/capture/ocr/browser.ts';
	import { compressPhoto } from '#lib/capture/image.ts';
	import { CaptureSession } from '#lib/capture/session.svelte.ts';
	import { db, type ExtractedFields, type Item, type Store } from '#lib/data/db.ts';
	import {
		addItem,
		backfillAddedBy,
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
	import {
		changeTripStore,
		finishTrip,
		leaveTrip,
		setReceiptTotal,
		setTripBudget,
		setTripDiscount,
		tripDiscount
	} from '#lib/data/trips.ts';
	import { account } from '#lib/auth/account.svelte.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { InviteError, leaveSharedTrip, removeTripPartner } from '#lib/sharing/invites.ts';
	import { letGoOfTrip } from '#lib/sync/letgo.ts';
	import { TripMembers } from '#lib/sharing/members.svelte.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
	import { applyDiscount, tripTotals, type Discount } from '#lib/money.ts';
	import AppHeader, { type MenuEntry } from './AppHeader.svelte';
	import BudgetForm from './BudgetForm.svelte';
	import DiscountForm from './DiscountForm.svelte';
	import CameraCapture from './CameraCapture.svelte';
	import FinishTrip from './FinishTrip.svelte';
	import InvitePartner from './InvitePartner.svelte';
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
		/** The shopper left with an empty cart; the trip is gone and this cart is about to close. */
		onleft?: (message?: string) => void;
	}

	let { tripId, onfinished, onleft }: Props = $props();

	// One live query for everything the cart shows; it re-runs when the trip, its store or
	// its items change.
	const cart = new LiveQuery(async () => {
		const trip = await db.trips.get(tripId);
		if (!trip) return undefined;
		const [store, items] = await Promise.all([getStore(trip.storeId), listTripItems(tripId)]);
		return { trip, store, items };
	});
	const stores = new LiveQuery(() => listStores());

	// Who is on the trip, so a shared one can say who added each item. Asked again after each
	// sync, since a partner can join at any time.
	const members = new TripMembers();
	$effect(() => {
		void syncEngine.lastSyncedAt;
		if (account.status === 'signedIn') void members.refresh(tripId);
	});
	// A trip that has just become shared: the owner owns what was put in before it was shared.
	$effect(() => {
		if (members.shared && members.roleOf(account.userId) === 'owner' && account.userId) {
			void backfillAddedBy(tripId, account.userId);
		}
	});

	type SheetState =
		| { kind: 'add'; capture?: CaptureSession }
		| { kind: 'edit'; item: Item }
		| { kind: 'budget' }
		| { kind: 'discount' }
		| { kind: 'store' }
		| { kind: 'invite' }
		| { kind: 'leaveShared' }
		| { kind: 'removePartner' }
		| { kind: 'finish' };
	let sheet = $state<SheetState | null>(null);
	let camera = $state(false);
	let viewing = $state<Item>();
	let toast = $state<{ id: number; message: string; undoItemId?: string } | null>(null);
	let toastCount = 0;

	const trip = $derived(cart.current?.trip);
	const store = $derived(cart.current?.store);
	const items = $derived(cart.current?.items ?? []);
	const discount = $derived(tripDiscount(trip));
	const totals = $derived(applyDiscount(tripTotals(items, store?.taxRateBps ?? 0), discount));
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
		await addItem(tripId, input, { photo, extracted, addedBy: account.userId });
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

	function tapStoreName() {
		if (items.length > 0) show('The store can only be changed while the cart is empty.');
		else sheet = { kind: 'store' };
	}

	async function pickStore(next: Store) {
		sheet = null;
		await run(() => changeTripStore(tripId, next.id));
	}

	/** Leaving or removing is about the trip's people, so the cart says what it will do first. */
	const role = $derived(members.roleOf(account.userId));
	const menu = $derived.by(() => {
		const entries: MenuEntry[] = [
			{ label: 'History', href: resolve('/history') },
			{ label: 'Stores', href: resolve('/stores') }
		];
		if (role === 'partner') {
			entries.push({ label: 'Leave this trip', onclick: () => (sheet = { kind: 'leaveShared' }) });
		} else if (members.shared) {
			entries.push({ label: 'Remove partner', onclick: () => (sheet = { kind: 'removePartner' }) });
		} else {
			entries.push({ label: 'Invite a partner', onclick: tapInvite });
		}
		entries.push({
			label: discount ? 'Change discount' : 'Add discount',
			onclick: () => (sheet = { kind: 'discount' })
		});
		if (items.length) entries.push({ label: 'Finish trip', onclick: tapFinish, primary: true });
		// A partner cannot delete the owner's trip, so an empty cart is left by leaving the trip.
		else if (role !== 'partner')
			entries.push({ label: 'Leave store', onclick: leave, primary: true });
		return entries;
	});

	async function leaveSharedTripNow() {
		sheet = null;
		try {
			await leaveSharedTrip(tripId);
		} catch (cause) {
			show(cause instanceof InviteError ? cause.message : 'Something went wrong. Try again.');
			return;
		}
		// The trip stays with its owner; this phone lets go of its copy.
		await letGoOfTrip(db, { tripId, storeId: trip!.storeId });
		onleft?.(
			`You left the trip at ${store?.name ?? 'the store'}. It stays with whoever invited you.`
		);
	}

	async function removePartnerNow() {
		sheet = null;
		try {
			await removeTripPartner(tripId);
			await members.refresh(tripId);
			show('Your partner is off the trip. What they added stays.');
		} catch (cause) {
			show(cause instanceof InviteError ? cause.message : 'Something went wrong. Try again.');
		}
	}

	async function tapInvite() {
		// Right after the app opens, who is signed in may still be being asked.
		if (account.status === 'unknown') await account.refresh();
		if (account.status === 'signedIn') sheet = { kind: 'invite' };
		else show('Sign in on the Account page to share this trip.');
	}

	function tapFinish() {
		sheet = { kind: 'finish' };
	}

	async function leave() {
		await run(async () => {
			await leaveTrip(tripId);
			onleft?.();
		});
	}

	async function finish() {
		const { photosKept } = await finishTrip(tripId);
		sheet = null;
		onfinished?.(photosKept);
	}

	async function saveDiscount(next: Discount | undefined) {
		await run(() => setTripDiscount(tripId, next));
		sheet = null;
	}

	async function saveBudget(budgetMinor: number | undefined) {
		await run(() => setTripBudget(tripId, budgetMinor));
		sheet = null;
	}
</script>

{#if trip && store}
	<div class="page">
		<AppHeader
			title={store.name}
			subtitle={store.branch}
			ontitle={tapStoreName}
			titleLabel="Store: {store.name}"
			{menu}
		/>

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
						addedBy={members.label(item.addedBy, account.userId)}
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
				<button class="btn btn-primary snap" type="button" onclick={() => (camera = true)}>
					📷 Snap label
				</button>
				<button class="btn manual" type="button" onclick={() => (sheet = { kind: 'add' })}>
					Add by hand
				</button>
			</div>
			<TotalsFooter
				{totals}
				{discount}
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

	<Sheet open={sheet?.kind === 'discount'} title="Discount" onclose={() => (sheet = null)}>
		{#if sheet?.kind === 'discount'}<DiscountForm {discount} onsave={saveDiscount} />{/if}
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

	<Sheet open={sheet?.kind === 'invite'} title="Invite a partner" onclose={() => (sheet = null)}>
		{#if sheet?.kind === 'invite'}<InvitePartner {tripId} />{/if}
	</Sheet>

	<Sheet
		open={sheet?.kind === 'leaveShared'}
		title="Leave this trip?"
		onclose={() => (sheet = null)}
	>
		<p>
			The trip stays with the person who invited you, along with the items you added. It will be
			gone from your phone.
		</p>
		<button class="btn btn-danger btn-block" type="button" onclick={leaveSharedTripNow}>
			Leave the trip
		</button>
	</Sheet>

	<Sheet
		open={sheet?.kind === 'removePartner'}
		title="Remove your partner?"
		onclose={() => (sheet = null)}
	>
		<p>
			They will no longer see or change this trip. What they added stays, and you can invite someone
			else.
		</p>
		<button class="btn btn-danger btn-block" type="button" onclick={removePartnerNow}>
			Remove partner
		</button>
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

	.actions {
		display: grid;
		grid-template-columns: 3fr 2fr;
		gap: 8px;
	}

	.actions .btn {
		min-height: 56px;
		padding: 0 12px;
		white-space: nowrap;
	}

	.snap {
		font-size: 1.15rem;
	}
</style>
