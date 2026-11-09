<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { untrack } from 'svelte';
	import {
		amountLabel,
		formatMoney,
		formatPercent,
		minorToInput,
		parsePercent,
		parsePounds,
		type Discount
	} from '#lib/money.ts';

	interface Props {
		discount?: Discount;
		onsave: (discount: Discount | undefined) => Promise<void>;
		/** The store's currency (ISO 4217); unset shows plain numbers. */
		currency?: string;
	}

	let { discount, onsave, currency }: Props = $props();
	const uid = $props.id();

	const initial = untrack(() => discount);
	let kind = $state<Discount['kind']>(initial?.kind ?? 'amount');
	let value = $state(
		initial
			? initial.kind === 'amount'
				? minorToInput(initial.value)
				: formatPercent(initial.value)
			: ''
	);
	let error = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const parsed = kind === 'amount' ? parsePounds(value) : parsePercent(value);
		if (!parsed) {
			error =
				kind === 'amount'
					? `Enter the discount like 5 or ${minorToInput(250)}.`
					: 'Enter a percentage between 0 and 100, like 10.';
			return;
		}
		await onsave({ kind, value: parsed });
	}
</script>

<form onsubmit={submit} novalidate>
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="form-rows">
		<div class="form-row">
			<span id="{uid}-kind">Kind</span>
			<div class="segmented" role="radiogroup" aria-labelledby="{uid}-kind">
				<label>
					<input type="radio" name="{uid}-kind" value="amount" bind:group={kind} />
					{amountLabel('Amount', currency)}
				</label>
				<label>
					<input type="radio" name="{uid}-kind" value="percent" bind:group={kind} />
					Percent (%)
				</label>
			</div>
		</div>

		<div class="form-row">
			<div class="with-info">
				<label for="{uid}-discount"
					>{kind === 'amount' ? amountLabel('Discount', currency) : 'Discount (%)'}</label
				>
				<InfoTip title="Discount">
					<p>
						Taken off the whole trolley, as at the till. It can't take the total below {formatMoney(
							0,
							currency
						)}.
					</p>
				</InfoTip>
			</div>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="{uid}-discount"
				class="input form-value amount"
				bind:value
				inputmode="decimal"
				placeholder={kind === 'amount' ? minorToInput(0) : '0'}
				aria-invalid={error !== ''}
				autofocus
			/>
		</div>
	</div>
	<button class="btn btn-primary btn-block" type="submit">Save discount</button>
	{#if discount}
		<button class="btn btn-block remove" type="button" onclick={() => onsave(undefined)}>
			Remove discount
		</button>
	{/if}
</form>

<style>
	.amount {
		max-width: 9rem;
		font-variant-numeric: tabular-nums;
	}

	.remove {
		margin-top: 8px;
	}
</style>
