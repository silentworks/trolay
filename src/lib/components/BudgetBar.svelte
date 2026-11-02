<script lang="ts">
	import { budgetStatus, formatMoney } from '#lib/money.ts';

	interface Props {
		/** What counts against the budget: the headline total. */
		spentMinor: number;
		budgetMinor?: number;
		currency?: string;
		onbudget: () => void;
	}

	let { spentMinor, budgetMinor, currency, onbudget }: Props = $props();

	const status = $derived(budgetMinor === undefined ? 'ok' : budgetStatus(spentMinor, budgetMinor));
	const left = $derived(budgetMinor === undefined ? 0 : budgetMinor - spentMinor);
	/** The bar's fill, 0–100; full once over. */
	const fill = $derived(
		budgetMinor ? Math.min(100, Math.round((spentMinor / budgetMinor) * 100)) : 0
	);
</script>

{#if budgetMinor === undefined}
	<button class="set" type="button" onclick={onbudget}>Set a budget</button>
{:else}
	<!-- The whole bar opens the budget sheet. -->
	<section class="budget" data-status={status} aria-label="Budget">
		<button type="button" onclick={onbudget} aria-label="Change the budget">
			<span class="line">
				<span class="label">Budget</span>
				<span class="figures">
					<strong>{formatMoney(spentMinor, currency)}</strong> of {formatMoney(
						budgetMinor,
						currency
					)}
				</span>
			</span>
			<span class="track" aria-hidden="true"><span class="fill" style:width="{fill}%"></span></span>
			<span class="left">
				{left >= 0
					? `${formatMoney(left, currency)} left`
					: `${formatMoney(-left, currency)} over budget`}
			</span>
		</button>
	</section>
{/if}

<style>
	.set {
		justify-self: start;
		min-height: 44px;
		padding: 0 4px;
		border: none;
		background: transparent;
		color: var(--accent);
		font-weight: 700;
	}

	.budget button {
		display: grid;
		gap: 6px;
		width: 100%;
		min-height: var(--tap);
		padding: 8px 4px;
		border: none;
		background: transparent;
		text-align: left;
	}

	.line {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 0.92rem;
	}

	.label,
	.figures {
		color: var(--muted);
	}

	.figures strong {
		color: var(--text);
		font-variant-numeric: tabular-nums;
	}

	.track {
		height: 8px;
		border-radius: 999px;
		background: var(--surface-2);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width 0.2s ease-out;
	}

	.left {
		color: var(--muted);
		font-size: 0.85rem;
	}

	[data-status='warning'] .fill {
		background: var(--warning);
	}

	[data-status='warning'] .left {
		color: var(--warning-text);
		font-weight: 700;
	}

	[data-status='over'] .fill {
		background: var(--danger);
	}

	[data-status='over'] .left {
		color: var(--danger-text);
		font-weight: 700;
	}
</style>
