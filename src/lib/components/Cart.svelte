<script lang="ts">
	import { flushSync } from 'svelte';
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
	import { toast, type ToastAction, type ToastTone } from '#lib/toast.svelte.ts';
	import { TripMembers } from '#lib/sharing/members.svelte.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
	import { applyDiscount, tripTotals, type Discount } from '#lib/money.ts';
	import { install } from '#lib/install.svelte.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { askDoneShopping } from '#lib/trip/done-shopping.ts';
	import { appUpdate } from '#lib/update.svelte.ts';
	import AppHeader, { type MenuEntry } from './AppHeader.svelte';
	import Banner from './Banner.svelte';
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
	let dock = $state<HTMLDivElement>();

	const trip = $derived(cart.current?.trip);
	const store = $derived(cart.current?.store);
	const items = $derived(cart.current?.items ?? []);
	const discount = $derived(tripDiscount(trip));
	const totals = $derived(applyDiscount(tripTotals(items, store?.taxRateBps ?? 0), discount));
	const photoCount = $derived(items.filter((item) => item.photoId).length);

	// Coming back to the trip after a break, the cart asks if the shop is done, so the receipt
	// gets checked. The clock is read when the cart opens and each time the app comes back to the
	// front, not while the shopper is using it.
	let openedAt = $state(Date.now());
	$effect(() => {
		const back = () => {
			if (document.visibilityState === 'visible') openedAt = Date.now();
		};
		document.addEventListener('visibilitychange', back);
		return () => document.removeEventListener('visibilitychange', back);
	});
	const doneShopping = $derived(
		askDoneShopping({
			tripId,
			items,
			now: openedAt,
			dismissedTripId: settings.doneShoppingDismissed
		}) &&
			!sheet &&
			!camera &&
			// One banner at a time: the app's own ones go first.
			!appUpdate.available &&
			!install.offered
	);

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

	// Toasts sit just above the dock, so the totals stay in view.
	$effect(() => {
		if (!dock) return;
		const target = dock;
		const observer = new ResizeObserver(() => (toast.lift = target.offsetHeight));
		observer.observe(target);
		return () => {
			observer.disconnect();
			toast.lift = 0;
		};
	});

	function show(message: string, action?: ToastAction, tone?: ToastTone) {
		toast.show({ message, action, tone });
	}

	async function run(action: () => Promise<void>) {
		try {
			await action();
		} catch (e) {
			toast.error(e);
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
		show('Photo updated', undefined, 'success');
	}

	function remove(item: Item) {
		sheet = null;
		run(async () => {
			await deleteItem(item.id);
			show(`Deleted ${itemName(item)}`, { label: 'Undo', run: () => undo(item.id) });
		});
	}

	function undo(itemId: string) {
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
	/**
	 * Leave store deletes the trip, so it's only offered on a trip of the shopper's own: not to a
	 * partner, even before the trip's members have loaded (its owner is on the trip itself).
	 */
	const canLeave = $derived(
		role !== 'partner' && (!trip?.ownerId || trip.ownerId === account.userId)
	);
	const menu = $derived.by(() => {
		const entries: MenuEntry[] = [
			{ label: 'Stores', href: resolve('/stores') },
			{ label: 'Settings', href: resolve('/settings') }
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
			toast.error(cause instanceof InviteError ? cause : 'Something went wrong. Try again.');
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
			toast.error(cause instanceof InviteError ? cause : 'Something went wrong. Try again.');
		}
	}

	async function tapInvite() {
		// Right after the app opens, who is signed in may still be being asked.
		if (account.status === 'unknown') await account.refresh();
		if (account.status === 'signedIn') sheet = { kind: 'invite' };
		else show('Sign in from Settings to share this trip.');
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
			history={resolve('/history')}
			start
			sync
			{menu}
		/>

		<div class="status">
			<span class="pill">Open trip</span>
			<span class="count">{totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'}</span>
		</div>

		{#if items.length}
			<ul class="items" aria-label="Items in your trolley">
				{#each items as item (item.id)}
					<ItemRow
						{item}
						taxRateBps={store.taxRateBps}
						currency={store.currency}
						onedit={() => (sheet = { kind: 'edit', item })}
						ondelete={() => remove(item)}
						onquantity={(quantity) => run(() => setQuantity(item.id, quantity))}
						addedBy={members.label(item.addedBy, account.userId)}
					/>
				{/each}
			</ul>
		{:else}
			<div class="empty">
				<p class="big">Your trolley is empty.</p>
				<p>Snap a shelf price to add the first item and start the running total.</p>
			</div>
		{/if}

		<div class="dock" bind:this={dock}>
			<TotalsFooter
				{totals}
				{discount}
				currency={store.currency}
				taxRateBps={store.taxRateBps}
				taxAddedAtTill={!store.pricesIncludeTax}
				budgetMinor={trip.budgetMinor}
				onbudget={() => (sheet = { kind: 'budget' })}
				onfinish={items.length ? tapFinish : undefined}
				onleave={!items.length && canLeave ? leave : undefined}
			/>
			<div class="actions">
				<button class="btn btn-primary snap" type="button" onclick={() => (camera = true)}>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M4 8h3l2-3h6l2 3h3v11H4z" />
						<circle cx="12" cy="13" r="3.5" />
					</svg>
					Snap price
				</button>
				<button
					class="btn manual"
					type="button"
					aria-label="Add by hand"
					title="Add by hand"
					onclick={() => {
						// Opened within the tap, so the description's autofocus also brings up a
						// phone's keyboard: iOS only does that for focus moved during a tap.
						flushSync(() => (sheet = { kind: 'add' }));
					}}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<rect x="3" y="6" width="18" height="12" rx="2" />
						<path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
					</svg>
				</button>
			</div>
		</div>
	</div>

	{#if doneShopping}
		<Banner label="Done shopping?">
			{#snippet icon()}
				<svg viewBox="0 0 24 24">
					<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3" />
				</svg>
			{/snippet}
			Done shopping? Finish the trip and check your receipt.
			{#snippet actions()}
				<button
					class="btn btn-primary"
					type="button"
					onclick={() => {
						settings.dismissDoneShopping(tripId);
						tapFinish();
					}}>Finish trip</button
				>
				<button
					class="btn btn-ghost"
					type="button"
					onclick={() => settings.dismissDoneShopping(tripId)}>Not yet</button
				>
			{/snippet}
		</Banner>
	{/if}

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
				currency={store.currency}
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
				onphoto={() => (viewing = item)}
				storeId={store.id}
				currency={store.currency}
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
		<BudgetForm budgetMinor={trip.budgetMinor} onsave={saveBudget} currency={store?.currency} />
	</Sheet>

	<Sheet open={sheet?.kind === 'discount'} title="Discount" onclose={() => (sheet = null)}>
		{#if sheet?.kind === 'discount'}<DiscountForm
				{discount}
				onsave={saveDiscount}
				currency={store?.currency}
			/>{/if}
	</Sheet>

	<Sheet open={sheet?.kind === 'finish'} title="Finish trip" onclose={() => (sheet = null)}>
		<FinishTrip
			appTotalMinor={totals.inclMinor}
			receiptTotalMinor={trip.receiptTotalMinor}
			currency={store?.currency}
			taxRateBps={store?.taxRateBps ?? 0}
			taxAdded={(store?.taxRateBps ?? 0) > 0 && items.some((item) => !item.priceIncludesTax)}
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
		padding-bottom: calc(290px + env(safe-area-inset-bottom));
	}

	.status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: -4px 0 10px;
	}

	.pill {
		padding: 3px 10px;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-soft-text);
		font-size: 0.85rem;
		font-weight: 700;
	}

	.count {
		color: var(--muted);
		font-size: 0.92rem;
	}

	.items {
		list-style: none;
		margin: 0 0 12px;
		padding: 0;
	}

	.empty {
		text-align: center;
		color: var(--muted);
		padding: 40px 0;
	}

	.empty .big {
		font-size: 1.2rem;
		font-weight: 700;
		color: var(--text);
	}

	/* The total and the main action in the bottom third, always visible. */
	.dock {
		position: fixed;
		inset: auto 0 0;
		display: grid;
		gap: 10px;
		max-width: 560px;
		margin: 0 auto;
		padding: 10px var(--gutter) calc(12px + env(safe-area-inset-bottom));
		background: var(--bg);
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
	}

	.actions .btn {
		min-height: 58px;
		border-radius: 18px;
	}

	.snap {
		font-size: 1.15rem;
	}

	.actions svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.manual {
		width: 58px;
		padding: 0;
	}
</style>
