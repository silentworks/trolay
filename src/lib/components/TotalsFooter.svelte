<script lang="ts">
	import {
		budgetStatus,
		formatMoney,
		formatPercent,
		headlineTotal,
		type Discount,
		type DiscountedTotals
	} from '#lib/money.ts';
	import { settings } from '#lib/settings.svelte.ts';

	interface Props {
		totals: DiscountedTotals;
		discount?: Discount;
		/** Only for the spoken update; the budget bar shows it. */
		budgetMinor?: number;
		/** The store's currency (ISO 4217); unset shows plain numbers. */
		currency?: string;
		/** The store's shelf prices leave tax out and the till adds it. */
		taxAddedAtTill?: boolean;
	}

	let { totals, discount, budgetMinor, currency, taxAddedAtTill }: Props = $props();

	const mode = $derived(settings.totalMode);
	const headline = $derived(headlineTotal(totals, mode));
	const status = $derived(budgetMinor === undefined ? 'ok' : budgetStatus(headline, budgetMinor));
	const modeLabel = $derived(mode === 'incl' ? 'incl. tax' : 'excl. tax');
	/** The other total, shown small under the headline. */
	const other = $derived(
		mode === 'incl'
			? `${formatMoney(totals.exclMinor, currency)} excl. tax`
			: `${formatMoney(totals.inclMinor, currency)} incl. tax`
	);
</script>

<!-- The running total, on a dark card. Tapping it switches the headline between incl. and excl. tax. -->
<section class="totals" aria-label="Trolley total">
	<button
		class="headline"
		type="button"
		onclick={() => settings.toggleTotalMode()}
		aria-label="Total {formatMoney(headline, currency)} {modeLabel}. Tap to show the total {mode ===
		'incl'
			? 'excluding'
			: 'including'} tax."
	>
		<span class="mode">Total {modeLabel}</span>
		<span class="amount">{formatMoney(headline, currency)}</span>
	</button>

	<dl class="under">
		<div>
			<dt class="visually-hidden">{mode === 'incl' ? 'Excl. tax' : 'Incl. tax'}</dt>
			<dd>{other}</dd>
		</div>
		{#if totals.discountMinor > 0}
			<div>
				<dt>
					Discount{discount?.kind === 'percent' ? ` (${formatPercent(discount.value)}%)` : ''}
				</dt>
				<dd>−{formatMoney(totals.discountMinor, currency)}</dd>
			</div>
		{/if}
		<div class="tax">
			<dt class="visually-hidden">{taxAddedAtTill ? 'Tax (added at till)' : 'Tax'}</dt>
			<dd>
				{formatMoney(totals.taxMinor, currency)}
				{taxAddedAtTill ? 'tax (added at till)' : 'tax'}
			</dd>
		</div>
	</dl>

	<!-- Announces changes to screen readers without moving focus. -->
	<p class="visually-hidden" aria-live="polite">
		Total {formatMoney(headline, currency)}
		{modeLabel}, {totals.itemCount}
		{totals.itemCount === 1 ? 'item' : 'items'}{#if budgetMinor !== undefined}{status === 'over'
				? ', over budget'
				: status === 'warning'
					? ', nearly at budget'
					: ''}{/if}.
	</p>
</section>

<style>
	.totals {
		display: grid;
		gap: 6px;
		padding: 14px 16px 12px;
		border-radius: 18px;
		background: var(--total-bg);
		color: var(--total-text);
	}

	.headline {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		min-height: var(--tap);
		padding: 0;
		border: none;
		background: transparent;
		color: inherit;
		text-align: left;
	}

	.mode {
		font-size: 0.95rem;
		color: var(--total-muted);
	}

	.amount {
		font-size: 2rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	.under {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 2px 12px;
		margin: 0;
		color: var(--total-muted);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}

	.under div {
		display: flex;
		gap: 6px;
	}

	.under dd {
		margin: 0;
	}

	.tax {
		margin-left: auto;
	}
</style>
