<script lang="ts">
	import {
		budgetStatus,
		formatMoney,
		formatPercent,
		type Discount,
		type DiscountedTotals
	} from '#lib/money.ts';

	interface Props {
		totals: DiscountedTotals;
		discount?: Discount;
		budgetMinor?: number;
		onbudget: () => void;
		/** Opens the Finish trip sheet; the button is left out when unset, as on an empty cart. */
		onfinish?: () => void;
		/** The store's currency (ISO 4217); unset shows plain numbers. */
		currency?: string;
		taxRateBps: number;
		/** The store's shelf prices leave tax out and the till adds it. */
		taxAddedAtTill?: boolean;
	}

	let {
		totals,
		discount,
		budgetMinor,
		onbudget,
		onfinish,
		currency,
		taxRateBps,
		taxAddedAtTill
	}: Props = $props();

	// The headline is what is paid; the excl. total, tax and item count sit under it.
	const headline = $derived(totals.inclMinor);
	const status = $derived(budgetMinor === undefined ? 'ok' : budgetStatus(headline, budgetMinor));
	const left = $derived(budgetMinor === undefined ? 0 : budgetMinor - headline);
	/** The bar fills as the budget is spent; full once over. */
	const fill = $derived(
		budgetMinor ? Math.min(100, Math.round((headline / budgetMinor) * 100)) : 0
	);
	const money = (minor: number) => formatMoney(minor, currency);
</script>

<!-- The running total on a dark card: what is paid, then excl. tax, items and tax, then the budget.
     Finish trip sits beside the total, where the shopper looks at the till. -->
<section class="totals" aria-label="Trolley total">
	<div class="head">
		<div>
			<p class="mode">Total incl. tax</p>
			<p class="amount">{money(headline)}</p>
		</div>
		{#if onfinish}
			<button class="finish" type="button" onclick={onfinish}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
				Finish trip
			</button>
		{/if}
	</div>
	<dl class="under">
		<div>
			<dt class="visually-hidden">Excl. tax</dt>
			<dd>{money(totals.exclMinor)} excl.</dd>
		</div>
		<div>
			<dt class="visually-hidden">Items</dt>
			<dd>{totals.itemCount} {totals.itemCount === 1 ? 'item' : 'items'}</dd>
		</div>
		<div>
			<dt class="visually-hidden">
				Tax ({formatPercent(taxRateBps)}%{taxAddedAtTill ? ', added at till' : ''})
			</dt>
			<dd>{money(totals.taxMinor)} {taxAddedAtTill ? 'tax at till' : 'tax'}</dd>
		</div>
		{#if totals.discountMinor > 0}
			<div class="discount">
				<dt>
					Discount{discount?.kind === 'percent' ? ` (${formatPercent(discount.value)}%)` : ''}
				</dt>
				<dd>−{money(totals.discountMinor)}</dd>
			</div>
		{/if}
	</dl>

	{#if budgetMinor === undefined}
		<button class="set-budget" type="button" onclick={onbudget}>Set a budget</button>
	{:else}
		<section class="budget" data-status={status} aria-label="Budget">
			<button type="button" onclick={onbudget} aria-label="Budget: change it">
				<span class="line">
					<span>{left >= 0 ? 'Budget left' : 'Over budget'}</span>
					<span class="figures">
						{left >= 0
							? `${money(left)} of ${money(budgetMinor)}`
							: `${money(-left)} over ${money(budgetMinor)}`}
					</span>
				</span>
				<span class="track" aria-hidden="true"
					><span class="fill" style:width="{fill}%"></span></span
				>
			</button>
		</section>
	{/if}

	<!-- Announces changes to screen readers without moving focus. -->
	<p class="visually-hidden" aria-live="polite">
		Total {money(headline)} incl. tax, {totals.itemCount}
		{totals.itemCount === 1 ? 'item' : 'items'}{#if budgetMinor !== undefined}{status === 'over'
				? ', over budget'
				: status === 'warning'
					? ', nearly at budget'
					: ''}{/if}.
	</p>
</section>

<style>
	.totals {
		--line: rgb(255 255 255 / 0.12);
		--link: #a9c1ff;
		padding: calc(14px * var(--density)) 18px calc(16px * var(--density));
		border-radius: 18px;
		background: var(--total-bg);
		color: var(--total-text);
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.finish {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 6px;
		min-height: 44px;
		padding: 0 16px 0 12px;
		border: none;
		border-radius: 999px;
		background: #fff;
		color: #111827;
		font-weight: 700;
		white-space: nowrap;
	}

	.finish svg {
		width: 20px;
		height: 20px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.mode {
		margin: 0;
		color: var(--total-muted);
		font-size: 0.88rem;
	}

	.amount {
		margin: 0;
		font-size: 2.3rem;
		font-weight: 800;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}

	.under {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 2px 12px;
		margin: 2px 0 0;
		color: var(--total-muted);
		font-size: 0.88rem;
		font-variant-numeric: tabular-nums;
	}

	.under dd {
		margin: 0;
	}

	.discount {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		flex-basis: 100%;
	}

	.set-budget {
		min-height: 44px;
		color: var(--link);
		margin-top: 4px;
		padding: 0;
		border: none;
		background: transparent;
		font-weight: 700;
	}

	.budget button {
		display: grid;
		gap: 8px;
		width: 100%;
		margin-top: 10px;
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		text-align: left;
	}

	.line {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		color: var(--total-muted);
		font-size: 0.88rem;
	}

	.figures {
		font-variant-numeric: tabular-nums;
	}

	.track {
		height: 8px;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.14);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: #6f93ff;
		transition: width 0.2s ease-out;
	}

	[data-status='warning'] .fill {
		background: #fbbf24;
	}

	[data-status='warning'] .line {
		color: #fcd34d;
	}

	[data-status='over'] .fill {
		background: #f87171;
	}

	[data-status='over'] .line {
		color: #fca5a5;
	}
</style>
