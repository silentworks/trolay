<script lang="ts">
	import type { Item } from '#lib/data/db.ts';
	import { itemName } from '#lib/data/items.ts';
	import PhotoImage from './PhotoImage.svelte';
	import { formatGBP, lineTotals } from '#lib/money.ts';

	interface Props {
		item: Item;
		taxRateBps: number;
		onedit: () => void;
		ondelete: () => void;
		onquantity: (quantity: number) => void;
		onphoto: () => void;
		/** Who added it, on a shared trip: "you", a name. Nothing on a trip that is not shared. */
		addedBy?: string;
	}

	let { item, taxRateBps, onedit, ondelete, onquantity, onphoto, addedBy }: Props = $props();

	const totals = $derived(lineTotals(item, taxRateBps));
	const name = $derived(itemName(item));

	// Swipe left past the threshold to delete. Vertical movement is left to the page scroll.
	const SWIPE_DELETE_PX = 96;
	let startX = 0;
	let startY = 0;
	let offset = $state(0);
	let swiping = false;

	function pointerdown(event: PointerEvent) {
		startX = event.clientX;
		startY = event.clientY;
		swiping = false;
	}

	function pointermove(event: PointerEvent) {
		if (event.buttons === 0 && event.pointerType === 'mouse') return;
		const dx = event.clientX - startX;
		const dy = event.clientY - startY;
		if (!swiping && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) swiping = true;
		if (swiping) offset = Math.min(0, dx);
	}

	function pointerup() {
		if (swiping && offset <= -SWIPE_DELETE_PX) ondelete();
		offset = 0;
	}

	function click(event: MouseEvent) {
		// A swipe ends with a click on the same element; don't treat it as a tap.
		if (swiping) {
			event.preventDefault();
			swiping = false;
			return;
		}
		onedit();
	}
</script>

<li class="row" class:swiping={offset < 0} class:deleting={offset <= -SWIPE_DELETE_PX}>
	<div class="swipe-hint" aria-hidden="true">Delete</div>
	<!-- Swiping is a shortcut; the delete button is the accessible way to remove an item. -->
	<div
		class="content"
		role="presentation"
		style:transform="translateX({offset}px)"
		onpointerdown={pointerdown}
		onpointermove={pointermove}
		onpointerup={pointerup}
		onpointercancel={() => (offset = 0)}
	>
		{#if item.photoId}
			<button class="thumb" type="button" aria-label="Photo of {name}" onclick={onphoto}>
				{#key item.photoId}
					<PhotoImage photoId={item.photoId} size="thumb" alt="" />
				{/key}
			</button>
		{/if}
		<button class="main" type="button" onclick={click}>
			<span class="description" class:unnamed={!item.description}>{name}</span>
			<span class="meta">
				{formatGBP(item.unitPriceMinor)} each
				<span class="badge">{item.priceIncludesTax ? 'incl. VAT' : 'excl. VAT'}</span>
				{#if item.edited}<span class="badge edited">edited</span>{/if}
			</span>
			{#if addedBy}<span class="meta by">Added by {addedBy}</span>{/if}
		</button>

		<div class="side">
			<span class="line-total"
				>{formatGBP(item.priceIncludesTax ? totals.inclMinor : totals.exclMinor)}</span
			>
			<div class="stepper" role="group" aria-label="Quantity of {name}">
				<button
					class="btn"
					type="button"
					aria-label="Decrease quantity"
					disabled={item.quantity <= 1}
					onclick={() => onquantity(item.quantity - 1)}>−</button
				>
				<span class="qty" aria-live="polite">{item.quantity}</span>
				<button
					class="btn"
					type="button"
					aria-label="Increase quantity"
					onclick={() => onquantity(item.quantity + 1)}>+</button
				>
			</div>
		</div>

		<button class="btn btn-ghost delete" type="button" aria-label="Delete {name}" onclick={ondelete}
			>🗑</button
		>
	</div>
</li>

<style>
	.row {
		position: relative;
		overflow: hidden;
		border-radius: var(--radius);
	}

	/* The red layer only shows while swiping, so it can't bleed around the row's corners. */
	.row.swiping {
		background: var(--danger);
	}

	.row:not(.swiping) .swipe-hint {
		visibility: hidden;
	}

	.swipe-hint {
		position: absolute;
		inset: 0 16px 0 auto;
		display: flex;
		align-items: center;
		color: #fff;
		font-weight: 700;
	}

	.content {
		position: relative;
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 4px;
		padding: 8px 4px 8px 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		touch-action: pan-y;
		transition: transform 0.15s ease-out;
	}

	.deleting .content {
		opacity: 0.7;
	}

	.thumb {
		width: 52px;
		height: 52px;
		margin-left: 8px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface-2);
		overflow: hidden;
	}

	/* Rows without a photo: the description takes the thumbnail's column too. */
	.content > .main:first-child {
		grid-column: span 2;
	}

	.main {
		display: grid;
		gap: 2px;
		min-height: var(--tap);
		padding: 4px 12px;
		text-align: left;
		border: none;
		background: transparent;
	}

	.description {
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.description.unnamed {
		font-style: italic;
		color: var(--muted);
	}

	.meta {
		color: var(--muted);
		font-size: 0.9rem;
	}

	.badge {
		display: inline-block;
		margin-left: 4px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.8rem;
	}

	.badge.edited {
		background: var(--warning-bg);
		color: var(--warning-text);
	}

	.side {
		display: grid;
		justify-items: end;
		gap: 2px;
	}

	.line-total {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		padding-right: 4px;
	}

	.stepper {
		display: flex;
		align-items: center;
	}

	.stepper .btn {
		min-width: 44px;
		min-height: 44px;
		padding: 0;
	}

	.qty {
		min-width: 2.5ch;
		text-align: center;
		font-weight: 700;
	}

	.delete {
		padding: 0;
	}
</style>
