<script lang="ts">
	import { budgetStatus, formatGBP, headlineTotal, type TripTotals } from '#lib/money.ts';
	import { settings } from '#lib/settings.svelte.ts';

	interface Props {
		totals: TripTotals;
		budgetMinor?: number;
		onbudget: () => void;
	}

	let { totals, budgetMinor, onbudget }: Props = $props();

	const mode = $derived(settings.totalMode);
	const headline = $derived(headlineTotal(totals, mode));
	const status = $derived(budgetMinor === undefined ? 'ok' : budgetStatus(headline, budgetMinor));
	const left = $derived(budgetMinor === undefined ? 0 : budgetMinor - headline);
	const modeLabel = $derived(mode === 'incl' ? 'incl. VAT' : 'excl. VAT');
</script>

<section class="totals" data-status={status} aria-label="Trolley total">
	<button
		class="headline"
		type="button"
		onclick={() => settings.toggleTotalMode()}
		aria-label="Total {formatGBP(headline)} {modeLabel}. Tap to show the total {mode === 'incl'
			? 'excluding'
			: 'including'} VAT."
	>
		<span class="amount">{formatGBP(headline)}</span>
		<span class="mode">{modeLabel} · tap to switch</span>
	</button>

	<dl class="breakdown">
		<div>
			<dt>Incl. VAT</dt>
			<dd>{formatGBP(totals.inclMinor)}</dd>
		</div>
		<div>
			<dt>Excl. VAT</dt>
			<dd>{formatGBP(totals.exclMinor)}</dd>
		</div>
		<div>
			<dt>VAT</dt>
			<dd>{formatGBP(totals.taxMinor)}</dd>
		</div>
		<div>
			<dt>Items</dt>
			<dd>{totals.itemCount}</dd>
		</div>
	</dl>

	<button class="budget" type="button" onclick={onbudget}>
		{#if budgetMinor === undefined}
			Set a budget
		{:else if left >= 0}
			{formatGBP(left)} left of {formatGBP(budgetMinor)}
		{:else}
			{formatGBP(-left)} over budget of {formatGBP(budgetMinor)}
		{/if}
	</button>

	<!-- Announces changes to screen readers without moving focus. -->
	<p class="visually-hidden" aria-live="polite">
		Total {formatGBP(headline)}
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
		grid-template-columns: 1fr auto;
		gap: 4px 12px;
		align-items: center;
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 2px solid var(--border);
	}

	.totals[data-status='warning'] {
		background: var(--warning-bg);
		border-color: var(--warning-text);
		color: var(--warning-text);
	}

	.totals[data-status='over'] {
		background: var(--danger-bg);
		border-color: var(--danger);
		color: var(--danger-text);
	}

	.headline {
		display: grid;
		justify-items: start;
		min-height: var(--tap);
		padding: 0;
		border: none;
		background: transparent;
		text-align: left;
	}

	.amount {
		font-size: 1.9rem;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
		line-height: 1.1;
	}

	.mode {
		font-size: 0.85rem;
		opacity: 0.85;
	}

	.breakdown {
		display: grid;
		grid-template-columns: auto auto;
		gap: 0 10px;
		margin: 0;
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
	}

	.breakdown div {
		display: contents;
	}

	.breakdown dt {
		opacity: 0.85;
	}

	.breakdown dd {
		margin: 0;
		text-align: right;
		font-weight: 600;
	}

	.budget {
		grid-column: 1 / -1;
		min-height: 44px;
		border: none;
		border-top: 1px solid currentColor;
		background: transparent;
		font-weight: 700;
		text-align: left;
		padding: 6px 0 0;
		border-top-color: color-mix(in srgb, currentColor 25%, transparent);
	}
</style>
