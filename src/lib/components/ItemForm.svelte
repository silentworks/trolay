<script lang="ts">
	import { untrack } from 'svelte';
	import type { Item } from '#lib/data/db.ts';
	import type { ItemInput } from '#lib/data/items.ts';
	import { formatGBP, lineTotals, minorToInput, parsePounds } from '#lib/money.ts';

	interface Props {
		item?: Item;
		defaultIncludesTax: boolean;
		taxRateBps: number;
		onsave: (input: ItemInput) => Promise<void>;
		ondelete?: () => void;
		onrevert?: () => Promise<void>;
	}

	let { item, defaultIncludesTax, taxRateBps, onsave, ondelete, onrevert }: Props = $props();
	const uid = $props.id();

	// Initial values only: the form edits its own copy until it is saved.
	const initial = untrack(() => ({ item, defaultIncludesTax }));
	let description = $state(initial.item?.description ?? '');
	let price = $state(initial.item ? minorToInput(initial.item.unitPriceMinor) : '');
	let quantity = $state(initial.item?.quantity ?? 1);
	let priceIncludesTax = $state(initial.item?.priceIncludesTax ?? initial.defaultIncludesTax);
	let error = $state('');
	let saving = $state(false);

	const unitPriceMinor = $derived(parsePounds(price));
	const preview = $derived(
		unitPriceMinor === null
			? null
			: lineTotals({ unitPriceMinor, quantity, priceIncludesTax }, taxRateBps)
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (unitPriceMinor === null) {
			error = 'Enter a price like 1.45.';
			return;
		}
		saving = true;
		error = '';
		try {
			await onsave({ description, unitPriceMinor, priceIncludesTax, quantity });
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	async function revert() {
		await onrevert?.();
		// The sheet closes after reverting, so the form never shows stale values.
	}
</script>

<form onsubmit={submit} novalidate>
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="field">
		<label for="{uid}-description">Description</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id="{uid}-description"
			class="input"
			bind:value={description}
			autocomplete="off"
			autofocus={!item}
		/>
	</div>

	<div class="row">
		<div class="field">
			<label for="{uid}-price">Unit price (£)</label>
			<input
				id="{uid}-price"
				class="input"
				bind:value={price}
				inputmode="decimal"
				aria-invalid={price !== '' && unitPriceMinor === null}
			/>
		</div>

		<div class="field">
			<span class="label" id="{uid}-qty-label">Quantity</span>
			<div class="stepper" role="group" aria-labelledby="{uid}-qty-label">
				<button
					class="btn"
					type="button"
					aria-label="Decrease quantity"
					disabled={quantity <= 1}
					onclick={() => (quantity -= 1)}>−</button
				>
				<output aria-live="polite">{quantity}</output>
				<button
					class="btn"
					type="button"
					aria-label="Increase quantity"
					onclick={() => (quantity += 1)}>+</button
				>
			</div>
		</div>
	</div>

	<label class="check">
		<input type="checkbox" bind:checked={priceIncludesTax} />
		Price includes VAT
	</label>

	{#if preview}
		<p class="preview">
			Line total {formatGBP(preview.inclMinor)} incl. VAT · {formatGBP(preview.exclMinor)} excl.
		</p>
	{/if}

	<button class="btn btn-primary btn-block" type="submit" disabled={saving}>
		{item ? 'Save changes' : 'Add to cart'}
	</button>

	{#if item}
		<div class="secondary">
			{#if item.edited && onrevert}
				<button class="btn" type="button" onclick={revert}>Revert to label reading</button>
			{/if}
			{#if ondelete}
				<button class="btn btn-danger" type="button" onclick={ondelete}>Delete item</button>
			{/if}
		</div>
	{/if}
</form>

<style>
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
	}

	.stepper {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.stepper output {
		min-width: 2.5ch;
		text-align: center;
		font-weight: 700;
		font-size: 1.1rem;
	}

	.preview {
		color: var(--muted);
		margin: 4px 0 16px;
	}

	.secondary {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 12px;
	}

	.secondary .btn {
		flex: 1;
	}
</style>
