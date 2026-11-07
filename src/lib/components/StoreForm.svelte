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

	<div class="form-rows">
		<div class="form-row">
			<label for="{uid}-name">Store name</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="{uid}-name"
				class="input form-value"
				bind:value={name}
				required
				autocomplete="off"
				autofocus={!store}
			/>
		</div>

		<div class="form-row">
			<label for="{uid}-branch"
				>Branch or location <span class="visually-hidden">(optional)</span></label
			>
			<input id="{uid}-branch" class="input form-value" bind:value={branch} autocomplete="off" />
		</div>

		<div class="form-row">
			<div class="with-info">
				<label for="{uid}-currency">Currency <span class="visually-hidden">(optional)</span></label>
				{#if store}
					<InfoTip title="Currency">
						<p>
							Changing it changes how this store's past trips are shown too. The amounts stay the
							same.
						</p>
					</InfoTip>
				{/if}
			</div>
			<CurrencySelect id="{uid}-currency" class="form-value currency" bind:value={currency} />
		</div>

		<div class="form-row">
			<label for="{uid}-rate">Sales tax rate (%)</label>
			<input
				id="{uid}-rate"
				class="input form-value rate"
				bind:value={rate}
				inputmode="decimal"
				aria-describedby={hint ? `${uid}-rate-hint` : undefined}
			/>
			{#if hint}<p class="hint" id="{uid}-rate-hint">{hint}</p>{/if}
		</div>

		<div class="form-row">
			<div class="with-info">
				<span aria-hidden="true">Shelf prices</span>
				<InfoTip title="Shelf prices and sales tax">
					<p>
						<strong>Include tax:</strong> the prices on the shelf already include sales tax, and Trolay
						works out how much of each is tax.
					</p>
					<p>
						<strong>Tax at the till:</strong> sales tax is added when you pay, as in the US and Canada.
						Trolay adds it to your total so it matches the receipt.
					</p>
				</InfoTip>
			</div>
			<button
				class="toggle-pill"
				type="button"
				role="switch"
				aria-checked={pricesIncludeTax}
				aria-label="Shelf prices include sales tax"
				onclick={() => (pricesIncludeTax = !pricesIncludeTax)}
			>
				{pricesIncludeTax ? 'Include tax' : 'Tax at the till'}
			</button>
		</div>
	</div>

	<button class="btn btn-primary btn-block" type="submit" disabled={saving}>{submitLabel}</button>
</form>

<style>
	.form-row > .with-info {
		color: var(--muted);
		white-space: nowrap;
	}

	.rate {
		max-width: 7rem;
		font-variant-numeric: tabular-nums;
	}

	/* A select's own text sits at the start; line it up with the other values. */
	.form-row :global(.currency) {
		text-align-last: right;
	}

	.hint {
		color: var(--muted);
		font-size: 0.9rem;
	}
</style>
