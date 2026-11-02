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
		budgetMinor?: number;
		onbudget: () => void;
		/** The store's currency (ISO 4217); unset shows plain numbers. */
		currency?: string;
		taxRateBps: number;
		/** The store's shelf prices leave tax out and the till adds it. */
		taxAddedAtTill?: boolean;
	}

	let { totals, discount, budgetMinor, onbudget, currency, taxRateBps, taxAddedAtTill }: Props =
		$props();

	const mode = $derived(settings.totalMode);
	const headline = $derived(headlineTotal(totals, mode));
	const status = $derived(budgetMinor === undefined ? 'ok' : budgetStatus(headline, budgetMinor));
	const left = $derived(budgetMinor === undefined ? 0 : budgetMinor - headline);
	/** The bar fills as the budget is spent; full once over. */
	const fill = $derived(
		budgetMinor ? Math.min(100, Math.round((headline / budgetMinor) * 100)) : 0
	);
	const money = (minor: number) => formatMoney(minor, currency);
</script>

<!-- The running total on a dark card, with its breakdown and the budget. -->
<section class="totals" aria-label="Trolley total">
	<p class="mode">Total {mode === 'incl' ? 'incl. tax' : 'excl. tax'}</p>
	<p class="amount">{money(headline)}</p>
	<button class="switch" type="button" onclick={() => settings.toggleTotalMode()}>
		{mode === 'incl' ? 'Show excl.' : 'Show incl.'}
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
	</button>

	<dl class="breakdown">
		{#if totals.discountMinor > 0}
			<div>
				<dt>
					Discount{discount?.kind === 'percent' ? ` (${formatPercent(discount.value)}%)` : ''}
				</dt>
				<dd>−{money(totals.discountMinor)}</dd>
			</div>
		{/if}
		<div>
			<dt>{mode === 'incl' ? 'Excl. tax' : 'Incl. tax'}</dt>
			<dd>{money(mode === 'incl' ? totals.exclMinor : totals.inclMinor)}</dd>
		</div>
		<div>
			<dt>
				Tax ({taxAddedAtTill
					? `${formatPercent(taxRateBps)}%, added at till`
					: `${formatPercent(taxRateBps)}%`})
			</dt>
			<dd>{money(totals.taxMinor)}</dd>
		</div>
		<div>
			<dt>Items</dt>
			<dd>{totals.itemCount}</dd>
		</div>
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
		Total {money(headline)}
		{mode === 'incl' ? 'incl. tax' : 'excl. tax'}, {totals.itemCount}
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
		padding: 14px 18px 16px;
		border-radius: 18px;
		background: var(--total-bg);
		color: var(--total-text);
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

	.switch {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 36px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--link);
		font-size: 0.92rem;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.switch svg,
	.set-budget {
		color: var(--link);
	}

	.switch svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
	}

	.breakdown {
		display: grid;
		gap: 6px;
		margin: 6px 0 0;
		padding-top: 12px;
		border-top: 1px solid var(--line);
		font-size: 0.95rem;
	}

	.breakdown div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}

	.breakdown dt {
		color: var(--total-muted);
	}

	.breakdown dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}

	.set-budget {
		min-height: 44px;
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
