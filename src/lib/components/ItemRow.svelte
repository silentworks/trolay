<script lang="ts">
	import type { Item } from '#lib/data/db.ts';
	import { itemName } from '#lib/data/items.ts';
	import { formatMoney, lineTotals } from '#lib/money.ts';

	interface Props {
		item: Item;
		taxRateBps: number;
		onedit: () => void;
		ondelete: () => void;
		onquantity: (quantity: number) => void;
		/** Who added it, on a shared trip: "you", a name. Nothing on a trip that is not shared. */
		addedBy?: string;
		/** The store's currency (ISO 4217); unset shows plain numbers. */
		currency?: string;
	}

	let { item, taxRateBps, onedit, ondelete, onquantity, addedBy, currency }: Props = $props();

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

<li
	class="row"
	data-item={item.id}
	class:swiping={offset < 0}
	class:deleting={offset <= -SWIPE_DELETE_PX}
>
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
		<span class="dot" class:edited={item.edited} aria-hidden="true"></span>
		<button class="main" type="button" onclick={click}>
			<span class="description" class:unnamed={!item.description}>{name}</span>
			<span class="meta">
				{formatMoney(item.unitPriceMinor, currency)} each · {item.priceIncludesTax
					? 'incl. tax'
					: 'excl. tax'}
				{#if item.offerQuantity && item.offerPriceMinor}
					<span class="badge" class:applied={item.quantity >= item.offerQuantity}>
						{item.offerQuantity} for {formatMoney(item.offerPriceMinor, currency)}
					</span>
				{/if}
				{#if item.edited}<span class="badge edited">edited</span>{/if}
			</span>
			{#if addedBy}<span class="meta by">Added by {addedBy}</span>{/if}
		</button>

		<div class="stepper" role="group" aria-label="Quantity of {name}">
			<button
				type="button"
				aria-label="Decrease quantity"
				disabled={item.quantity <= 1}
				onclick={() => onquantity(item.quantity - 1)}>−</button
			>
			<span class="qty" aria-live="polite">{item.quantity}</span>
			<button
				type="button"
				aria-label="Increase quantity"
				onclick={() => onquantity(item.quantity + 1)}>+</button
			>
		</div>

		<span class="line-total"
			>{formatMoney(item.priceIncludesTax ? totals.inclMinor : totals.exclMinor, currency)}</span
		>

		<button class="delete" type="button" aria-label="Delete {name}" onclick={ondelete}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
			</svg>
		</button>
	</div>
</li>

<style>
	.row {
		position: relative;
		overflow: hidden;
		border-bottom: 1px solid var(--border);
	}

	.row:first-child {
		border-top: 1px solid var(--border);
	}

	/* The red layer only shows while swiping. */
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
		display: flex;
		align-items: center;
		gap: 6px;
		min-height: 72px;
		padding: 8px 0 8px 4px;
		background: var(--bg);
		touch-action: pan-y;
		transition: transform 0.15s ease-out;
	}

	.deleting .content {
		opacity: 0.7;
	}

	.dot {
		flex: none;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--accent);
	}

	.dot.edited {
		background: var(--warning);
	}

	.main {
		flex: 1;
		min-width: 0;
		display: grid;
		gap: 2px;
		min-height: var(--tap);
		padding: 2px 6px;
		text-align: left;
		border: none;
		background: transparent;
	}

	.description {
		font-weight: 700;
		font-size: 1rem;
		overflow-wrap: anywhere;
	}

	.description.unnamed {
		font-style: italic;
		color: var(--muted);
	}

	.meta {
		color: var(--muted);
		font-size: 0.85rem;
	}

	.badge {
		display: inline-block;
		margin-left: 4px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.78rem;
	}

	.badge.applied {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
		font-weight: 600;
	}

	.badge.edited {
		background: var(--warning-bg);
		color: var(--warning-text);
	}

	.stepper {
		flex: none;
		display: flex;
		align-items: center;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
	}

	.stepper button {
		width: 34px;
		height: 44px;
		padding: 0;
		border: none;
		border-radius: 999px;
		background: transparent;
		color: var(--text);
		font-size: 1.15rem;
		line-height: 1;
	}

	.stepper button:disabled {
		color: var(--muted);
		opacity: 0.45;
		cursor: not-allowed;
	}

	.qty {
		min-width: 2ch;
		text-align: center;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.line-total {
		flex: none;
		min-width: 4.2ch;
		text-align: right;
		font-weight: 800;
		font-size: 1rem;
		font-variant-numeric: tabular-nums;
	}

	.delete {
		flex: none;
		display: grid;
		place-items: center;
		width: 34px;
		height: 44px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--muted);
	}

	.delete svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* A narrow phone: the stepper goes under the name, so the name keeps its room. */
	@media (max-width: 380px) {
		.content {
			flex-wrap: wrap;
		}

		.main {
			flex-basis: calc(100% - 120px);
		}

		.stepper {
			margin-left: 17px;
		}

		.line-total {
			margin-left: auto;
		}
	}
</style>
