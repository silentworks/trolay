<script lang="ts">
	import { untrack } from 'svelte';
	import type { Store } from '#lib/data/db.ts';
	import type { StoreInput } from '#lib/data/stores.ts';
	import { DEFAULT_VAT_BPS, formatPercent, parsePercent } from '#lib/money.ts';

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
	let vat = $state(formatPercent(initial?.taxRateBps ?? DEFAULT_VAT_BPS));
	let pricesIncludeTax = $state(initial?.pricesIncludeTax ?? true);
	let error = $state('');
	let saving = $state(false);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const taxRateBps = parsePercent(vat);
		if (taxRateBps === null) {
			error = 'Enter a VAT rate between 0 and 100.';
			return;
		}
		saving = true;
		error = '';
		try {
			await onsubmit({ name, branch, taxRateBps, pricesIncludeTax });
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
		<label for="{uid}-vat">VAT rate (%)</label>
		<input id="{uid}-vat" class="input" bind:value={vat} inputmode="decimal" />
	</div>

	<label class="check">
		<input type="checkbox" bind:checked={pricesIncludeTax} />
		Shelf labels include VAT
	</label>
	<p class="hint">
		UK labels usually include VAT, so leave this on unless the store shows ex-VAT prices.
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
