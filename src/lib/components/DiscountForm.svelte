<script lang="ts">
	import { untrack } from 'svelte';
	import {
		formatPercent,
		minorToInput,
		parsePercent,
		parsePounds,
		type Discount
	} from '#lib/money.ts';

	interface Props {
		discount?: Discount;
		onsave: (discount: Discount | undefined) => Promise<void>;
	}

	let { discount, onsave }: Props = $props();
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
					? 'Enter the discount like 5 or 2.50.'
					: 'Enter a percentage between 0 and 100, like 10.';
			return;
		}
		await onsave({ kind, value: parsed });
	}
</script>

<form onsubmit={submit} novalidate>
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="kinds" role="group" aria-label="Kind of discount">
		<button
			class="btn"
			type="button"
			aria-pressed={kind === 'amount'}
			onclick={() => (kind = 'amount')}>Amount (£)</button
		>
		<button
			class="btn"
			type="button"
			aria-pressed={kind === 'percent'}
			onclick={() => (kind = 'percent')}>Percent (%)</button
		>
	</div>

	<div class="field">
		<label for="{uid}-discount">{kind === 'amount' ? 'Discount (£)' : 'Discount (%)'}</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input id="{uid}-discount" class="input" bind:value inputmode="decimal" autofocus />
		<span class="hint">
			Taken off the whole trolley, as at the till. It can't take the total below £0.
		</span>
	</div>
	<button class="btn btn-primary btn-block" type="submit">Save discount</button>
	{#if discount}
		<button class="btn btn-block remove" type="button" onclick={() => onsave(undefined)}>
			Remove discount
		</button>
	{/if}
</form>

<style>
	.kinds {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-bottom: 12px;
	}

	.kinds [aria-pressed='true'] {
		border-color: var(--accent);
		border-width: 2px;
		font-weight: 700;
	}

	.remove {
		margin-top: 8px;
	}
</style>
