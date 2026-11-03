<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { untrack } from 'svelte';
	import type { Store } from '#lib/data/db.ts';
	import type { StoreInput } from '#lib/data/stores.ts';
	import { formatPercent, parsePercent } from '#lib/money.ts';
	import { rateHint, regionTax } from '#lib/taxes.ts';
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
	const hint = initial ? undefined : rateHint(guess);
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
		<div class="with-info">
			<label for="{uid}-currency">Currency <span class="hint">(optional)</span></label>
			{#if store}
				<InfoTip title="Currency">
					<p>
						Changing it changes how this store's past trips are shown too. The amounts stay the
						same.
					</p>
				</InfoTip>
			{/if}
		</div>
		<CurrencySelect id="{uid}-currency" bind:value={currency} />
	</div>

	<div class="field">
		<label for="{uid}-rate">Sales tax rate (%)</label>
		<input id="{uid}-rate" class="input" bind:value={rate} inputmode="decimal" />
		{#if hint}<span class="hint">{hint}</span>{/if}
	</div>

	<div class="with-info tax">
		<label class="check">
			<input type="checkbox" bind:checked={pricesIncludeTax} />
			Shelf prices include sales tax
		</label>
		<InfoTip title="Shelf prices and sales tax">
			<p>
				Ticked, the prices on the shelf already include sales tax, and Trolay works out how much of
				each is tax.
			</p>
			<p>
				Unticked, sales tax is added at the till, as in the US and Canada. Trolay adds it to your
				total so it matches the receipt.
			</p>
		</InfoTip>
	</div>

	<button class="btn btn-primary btn-block" type="submit" disabled={saving}>{submitLabel}</button>
</form>

<style>
	.hint {
		color: var(--muted);
		font-size: 0.9rem;
		margin: 0 0 16px;
	}
</style>
