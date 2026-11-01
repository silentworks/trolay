<script lang="ts">
	import { untrack } from 'svelte';
	import { isValidGtin } from '#lib/capture/gtin.ts';
	import { filledFields } from '#lib/capture/label/parse.ts';
	import type { CaptureSession } from '#lib/capture/session.svelte.ts';
	import type { ExtractedFields, Item } from '#lib/data/db.ts';
	import type { ItemInput } from '#lib/data/items.ts';
	import { isLookupPending, lookupProductName } from '#lib/data/products.ts';
	import { formatGBP, lineTotals, minorToInput, parsePounds } from '#lib/money.ts';
	import CameraCapture from './CameraCapture.svelte';
	import PhotoImage from './PhotoImage.svelte';

	interface Props {
		item?: Item;
		/** A snapped label being added: its photo is shown and its readings fill the form. */
		capture?: CaptureSession;
		/** For naming a scanned barcode from earlier shops at this store. */
		storeId: string;
		defaultIncludesTax: boolean;
		taxRateBps: number;
		/** `extracted` holds what the label reader filled in, for a snapped label. */
		onsave: (input: ItemInput, extracted?: ExtractedFields) => Promise<void>;
		ondelete?: () => void;
		onrevert?: () => Promise<void>;
		/** Editing: replaces the item's photo with a new one. */
		onretake?: (photo: Blob) => Promise<void>;
	}

	let {
		item,
		capture,
		storeId,
		defaultIncludesTax,
		taxRateBps,
		onsave,
		ondelete,
		onrevert,
		onretake
	}: Props = $props();
	const uid = $props.id();

	// Initial values only: the form edits its own copy until it is saved.
	const initial = untrack(() => ({ item, defaultIncludesTax, barcode: capture?.barcode }));
	let description = $state(initial.item?.description ?? '');
	let price = $state(initial.item ? minorToInput(initial.item.unitPriceMinor) : '');
	let quantity = $state(initial.item?.quantity ?? 1);
	let priceIncludesTax = $state(initial.item?.priceIncludesTax ?? initial.defaultIncludesTax);
	// A multi-buy offer ("2 for £3.00"): both boxes empty means none.
	let offerQuantity = $state(initial.item?.offerQuantity ? String(initial.item.offerQuantity) : '');
	let offerPrice = $state(
		initial.item?.offerPriceMinor ? minorToInput(initial.item.offerPriceMinor) : ''
	);
	// What the label printed per kg, per 100g and so on: shown, never used in the total.
	let perUnit = $state(initial.item?.extracted?.perUnit);
	let offerRead = $state(false);
	let barcode = $state(initial.item?.barcode ?? initial.barcode ?? '');
	let camera = $state<'barcode' | 'label'>();
	let error = $state('');
	let saving = $state(false);

	// Readings never overwrite what the shopper has typed, even if they arrive later.
	const touched = { description: false, price: false, vat: false, barcode: false, offer: false };
	// Fields the label reader tried but could not read with confidence: highlighted, left empty.
	let unread = $state({ description: false, price: false });
	// The read price agreed with the unit price printed on the label (price ÷ pack size).
	let priceChecked = $state(false);
	let extracted: ExtractedFields | undefined;
	let applied = false;
	// A name found for the barcode beats the label reading: labels are often abbreviated.
	let nameLookup = $state<'looking' | 'own-item' | 'openfoodfacts' | 'queued'>();
	let descriptionFromLookup = false;

	$effect(() => {
		const reading = capture?.reading;
		const stage = capture?.stage;
		if (applied || !capture || (stage !== 'done' && stage !== 'failed')) return;
		applied = true;
		untrack(() => {
			const {
				description: readDescription,
				unitPriceMinor,
				priceIncludesTax: vat,
				multiBuy,
				perUnit: readPerUnit
			} = filledFields(reading);
			const read = { description: readDescription, unitPriceMinor, priceIncludesTax: vat };
			if (multiBuy && !touched.offer) {
				offerQuantity = String(multiBuy.quantity);
				offerPrice = minorToInput(multiBuy.totalMinor);
				offerRead = true;
			}
			if (readPerUnit) perUnit = readPerUnit;
			if (descriptionFromLookup) read.description = description;
			else if (read.description !== undefined && !touched.description) {
				description = read.description;
			}
			if (read.unitPriceMinor !== undefined && !touched.price) {
				price = minorToInput(read.unitPriceMinor);
				priceChecked =
					reading?.checks.includes('price matches the unit price and pack size') ?? false;
			}
			if (read.priceIncludesTax !== undefined && !touched.vat) {
				priceIncludesTax = read.priceIncludesTax;
			}
			unread = {
				description: read.description === undefined && !descriptionFromLookup,
				price: read.unitPriceMinor === undefined
			};
			const used = [
				read.description !== undefined && reading?.description,
				read.unitPriceMinor !== undefined && reading?.unitPriceMinor,
				read.priceIncludesTax !== undefined && reading?.priceIncludesTax
			]
				.filter((field) => field)
				.map((field) => (field as { confidence: number }).confidence);
			if (used.length) {
				extracted = {
					...read,
					...(multiBuy && { offer: multiBuy }),
					...(readPerUnit && { perUnit: readPerUnit }),
					confidence: Math.min(...used)
				};
			}
		});
	});

	// A barcode can turn up in the still photo after the sheet has opened.
	$effect(() => {
		const code = capture?.barcode;
		if (code) untrack(() => !touched.barcode && !barcode && (barcode = code));
	});

	// Name a new barcode (scanned, read or typed) from earlier shops or Open Food Facts.
	let lookedUp = untrack(() => initial.item?.barcode ?? '');
	$effect(() => {
		const code = barcode.replace(/\s/g, '');
		if (code === lookedUp || !isValidGtin(code)) return;
		lookedUp = code;
		untrack(() => lookUpName(code));
	});

	async function lookUpName(code: string) {
		if (touched.description) return;
		nameLookup = 'looking';
		const found = await lookupProductName(code, storeId).catch(() => undefined);
		if (lookedUp !== code) return;
		if (!found) {
			nameLookup = (await isLookupPending(code)) ? 'queued' : undefined;
			return;
		}
		nameLookup = found.source;
		if (touched.description) return;
		description = found.name;
		descriptionFromLookup = true;
		// For a snapped label, the filled-in name is what Revert goes back to.
		if (extracted) extracted.description = found.name;
		else if (capture) extracted = { description: found.name, confidence: 1 };
	}

	const unitPriceMinor = $derived(parsePounds(price));
	// null: boxes filled in but not usable; undefined: no offer.
	const offer = $derived.by(() => {
		if (offerQuantity.trim() === '' && offerPrice.trim() === '') return undefined;
		const count = /^\d{1,2}$/.test(offerQuantity.trim()) ? Number(offerQuantity.trim()) : NaN;
		const total = parsePounds(offerPrice);
		return count >= 2 && total ? { quantity: count, totalMinor: total } : null;
	});
	const preview = $derived(
		unitPriceMinor === null || offer === null
			? null
			: lineTotals(
					{
						unitPriceMinor,
						quantity,
						priceIncludesTax,
						offerQuantity: offer?.quantity,
						offerPriceMinor: offer?.totalMinor
					},
					taxRateBps
				)
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (unitPriceMinor === null) {
			error = 'Enter a price like 1.45.';
			return;
		}
		if (offer === null) {
			error = 'A multi-buy offer needs 2 or more items and a price, like 2 for 3.00.';
			return;
		}
		saving = true;
		error = '';
		try {
			await onsave(
				{
					description,
					unitPriceMinor,
					priceIncludesTax,
					quantity,
					barcode,
					offerQuantity: offer?.quantity,
					offerPriceMinor: offer?.totalMinor
				},
				extracted
			);
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

	{#if capture}
		<figure class="photo">
			<img src={capture.previewUrl} alt="The label you photographed" />
			<figcaption aria-live="polite" class:error={capture.stage === 'failed'}>
				{#if capture.stage === 'compressing' || capture.stage === 'reading'}
					<span class="spinner" aria-hidden="true"></span> Reading the label…
				{:else if capture.stage === 'failed'}
					{capture.error}. Fill in the details below; the item can still be added.
				{:else}
					Read from the label. Check before adding.
				{/if}
			</figcaption>
		</figure>
	{/if}

	{#if item && onretake}
		<div class="current-photo">
			{#if item.photoId}
				{#key item.photoId}
					<PhotoImage photoId={item.photoId} size="thumb" alt="Photo of the label" />
				{/key}
			{/if}
			<button class="btn" type="button" onclick={() => (camera = 'label')}>
				{item.photoId ? 'Retake photo' : 'Add a photo'}
			</button>
		</div>
	{/if}

	<div class="field" class:needs-check={unread.description && !description}>
		<label for="{uid}-description">Description</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			id="{uid}-description"
			class="input"
			bind:value={description}
			oninput={() => (touched.description = true)}
			autocomplete="off"
			autofocus={!item && !capture}
			aria-describedby={unread.description && !description ? `${uid}-description-check` : undefined}
		/>
		{#if nameLookup && !touched.description}
			<p class="lookup-hint" aria-live="polite">
				{#if nameLookup === 'looking'}
					Looking up the name…
				{:else if nameLookup === 'own-item'}
					Name from your earlier shopping.
				{:else if nameLookup === 'openfoodfacts'}
					Name from Open Food Facts.
				{:else if !description}
					No signal. Leave it blank and the name will be filled in when you're back online.
				{/if}
			</p>
		{/if}
		{#if unread.description && !description && nameLookup !== 'queued'}
			<p class="check-hint" id="{uid}-description-check">Couldn't read this. Please type it.</p>
		{/if}
	</div>

	<div class="row">
		<div class="field" class:needs-check={unread.price && !price}>
			<label for="{uid}-price">Unit price (£)</label>
			<input
				id="{uid}-price"
				class="input"
				bind:value={price}
				oninput={() => {
					touched.price = true;
					priceChecked = false;
				}}
				inputmode="decimal"
				aria-invalid={price !== '' && unitPriceMinor === null}
				aria-describedby={unread.price && !price ? `${uid}-price-check` : undefined}
			/>
			{#if unread.price && !price}
				<p class="check-hint" id="{uid}-price-check">Couldn't read the price. Please type it.</p>
			{:else if priceChecked}
				<p class="checked-hint">✓ Matches the unit price on the label</p>
			{/if}
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

	{#if perUnit}
		<p class="checked-hint">Label unit price: {perUnit}</p>
	{/if}

	<div class="field">
		<span class="label" id="{uid}-offer-label"
			>Multi-buy offer <span class="hint">(optional)</span></span
		>
		<div class="offer" role="group" aria-labelledby="{uid}-offer-label">
			<input
				class="input"
				aria-label="Offer: number of items"
				bind:value={offerQuantity}
				oninput={() => (touched.offer = true)}
				inputmode="numeric"
				placeholder="2"
			/>
			<span>for £</span>
			<input
				class="input"
				aria-label="Offer: price for the items"
				bind:value={offerPrice}
				oninput={() => (touched.offer = true)}
				inputmode="decimal"
				placeholder="3.00"
			/>
		</div>
		{#if offerRead && !touched.offer}
			<p class="checked-hint">✓ Read from the label. Applies to each set of {offerQuantity}.</p>
		{/if}
	</div>

	<label class="check">
		<input type="checkbox" bind:checked={priceIncludesTax} onchange={() => (touched.vat = true)} />
		Price includes VAT
	</label>

	<div class="field">
		<label for="{uid}-barcode">Barcode <span class="hint">(optional)</span></label>
		<div class="barcode">
			<input
				id="{uid}-barcode"
				class="input"
				bind:value={barcode}
				oninput={() => (touched.barcode = true)}
				inputmode="numeric"
				autocomplete="off"
			/>
			<button class="btn" type="button" onclick={() => (camera = 'barcode')}>Scan</button>
		</div>
	</div>

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

<CameraCapture
	open={camera !== undefined}
	mode={camera ?? 'barcode'}
	onbarcode={(code) => {
		barcode = code;
		touched.barcode = true;
		camera = undefined;
	}}
	oncapture={async (photo) => {
		camera = undefined;
		try {
			await onretake?.(photo);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}}
	onclose={() => (camera = undefined)}
/>

<style>
	.offer {
		display: grid;
		grid-template-columns: 5rem auto 1fr;
		align-items: center;
		gap: 8px;
	}

	.photo {
		margin: 0 0 12px;
	}

	.current-photo {
		display: grid;
		grid-template-columns: auto 1fr;
		align-items: center;
		gap: 12px;
		margin-bottom: 16px;
	}

	.current-photo :global(img) {
		width: 96px;
		height: 72px;
	}

	.photo figcaption {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 6px;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.spinner {
		width: 14px;
		height: 14px;
		border: 2px solid currentColor;
		border-right-color: transparent;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to {
			rotate: 360deg;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation: none;
		}
	}

	/* A field the label reader couldn't read: left empty and flagged for the shopper. */
	.needs-check .input {
		border-color: var(--warning-text);
		background: var(--warning-bg);
	}

	.lookup-hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.9rem;
	}

	.checked-hint {
		margin: 0;
		color: var(--accent);
		font-size: 0.9rem;
		font-weight: 600;
	}

	.check-hint {
		margin: 0;
		color: var(--warning-text);
		font-size: 0.9rem;
		font-weight: 600;
	}

	.photo img {
		display: block;
		width: 100%;
		max-height: 30dvh;
		object-fit: contain;
		border-radius: var(--radius);
		background: var(--surface-2);
	}

	.barcode {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
	}

	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: start;
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
