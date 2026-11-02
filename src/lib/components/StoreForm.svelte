<script lang="ts">
	import { untrack } from 'svelte';
	import type { Store } from '#lib/data/db.ts';
	import type { StoreInput } from '#lib/data/stores.ts';
	import { formatPercent, parsePercent } from '#lib/money.ts';
	import { regionTax } from '#lib/taxes.ts';
	import CurrencySelect from './CurrencySelect.svelte';

	interface Props {
		store?: Store;
		submitLabel: string;
		onsubmit: (input: StoreInput) => Promise<void>;
	}

	let { store, submitLabel, onsubmit }: Props = $props();
	const uid = $props.id();

	// Initial values only: the form edits its own copy.
	const initial = untrack(() => store);
	let name = $state(initial?.name ?? '');
	let branch = $state(initial?.branch ?? '');
	// A new store's rate is guessed from the phone's region; with no good guess it starts at 0%.
	const guess = initial ? undefined : regionTax();
	const askForRate = !initial && (!guess || guess.varies);
	let rate = $state(formatPercent(initial?.taxRateBps ?? guess?.rateBps ?? 0));
	let pricesIncludeTax = $state(initial?.pricesIncludeTax ?? true);
	let currency = $state(initial?.currency ?? '');
	let error = $state('');
	let saving = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const taxRateBps = parsePercent(rate);
		if (taxRateBps === null) {
			error = 'Enter a sales tax rate between 0 and 100.';
			return;
		}
		saving = true;
		error = '';
		try {
			await onsubmit({ name, branch, taxRateBps, pricesIncludeTax, currency });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}
</script>

<form onsubmit={submit} novalidate>
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="field">
		<label for="{uid}-name">Store name</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id="{uid}-name"
			class="input"
			bind:value={name}
			required
			autocomplete="off"
			autofocus={!store}
		/>
	</div>

	<div class="field">
		<label for="{uid}-branch">Branch or location <span class="hint">(optional)</span></label>
		<input id="{uid}-branch" class="input" bind:value={branch} autocomplete="off" />
	</div>

	<div class="field">
		<label for="{uid}-currency">Currency <span class="hint">(optional)</span></label>
		<CurrencySelect id="{uid}-currency" bind:value={currency} />
		{#if store}
			<span class="hint">
				Changing it changes how this store's past trips are shown too. The amounts stay the same.
			</span>
		{/if}
	</div>

	<div class="field">
		<label for="{uid}-rate">Sales tax rate (%)</label>
		<input id="{uid}-rate" class="input" bind:value={rate} inputmode="decimal" />
		{#if askForRate}
			<span class="hint"
				>Enter the sales tax rate where you shop. A recent receipt usually shows it.</span
			>
		{/if}
	</div>

	<label class="check">
		<input type="checkbox" bind:checked={pricesIncludeTax} />
		Shelf prices include sales tax
	</label>
	<p class="hint">
		Leave this on if the price on the shelf is what you pay. Turn it off if the store adds tax on
		top, at the till or on the receipt.
	</p>

	<button class="btn btn-primary btn-block" type="submit" disabled={saving}>{submitLabel}</button>
</form>

<style>
	.hint {
		color: var(--muted);
		font-size: 0.9rem;
		margin: 0 0 16px;
	}
</style>
