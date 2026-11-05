<script lang="ts">
	import { untrack } from 'svelte';
	import { isValidGtin } from '#lib/capture/gtin.ts';
	import { filledFields } from '#lib/capture/label/parse.ts';
	import type { CaptureSession } from '#lib/capture/session.svelte.ts';
	import type { ExtractedFields, Item } from '#lib/data/db.ts';
	import type { ItemInput } from '#lib/data/items.ts';
	import { isLookupPending, lookupProductName } from '#lib/data/products.ts';
	import {
		amountLabel,
		currencySymbol,
		formatMoney,
		lineTotals,
		minorToInput,
		parsePounds
	} from '#lib/money.ts';
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
		/** Editing: shows the item's photo full size. */
		onphoto?: () => void;
		/** The store's currency (ISO 4217); unset shows plain numbers. */
		currency?: string;
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
		onretake,
		onphoto,
		currency
	}: Props = $props();
	const uid = $props.id();

	// Initial values only: the form edits its own copy until it is saved.
	const initial = untrack(() => ({ item, defaultIncludesTax, barcode: capture?.barcode }));
	let description = $state(initial.item?.description ?? '');
	let price = $state(initial.item ? minorToInput(initial.item.unitPriceMinor) : '');
	let quantity = $state(initial.item?.quantity ?? 1);
	let priceIncludesTax = $state(initial.item?.priceIncludesTax ?? initial.defaultIncludesTax);
	// A multi-buy offer ("2 for 3.00"): both boxes empty means none.
	let offerQuantity = $state(initial.item?.offerQuantity ? String(initial.item.offerQuantity) : '');
	let offerPrice = $state(
		initial.item?.offerPriceMinor ? minorToInput(initial.item.offerPriceMinor) : ''
	);
	// The offer boxes stay hidden until wanted. Off means no offer, whatever the boxes hold.
	let offerOn = $state(Boolean(initial.item?.offerQuantity));
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
				offerOn = true;
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
		if (!offerOn || (offerQuantity.trim() === '' && offerPrice.trim() === '')) return undefined;
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
			error = `Enter a price like ${minorToInput(145)}.`;
			return;
		}
		if (offer === null) {
			error = `A multi-buy offer needs 2 or more items and a price, like 2 for ${minorToInput(300)}.`;
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
					<span class="chip">
						<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
						Label read
					</span>
					<span>Check before adding.</span>
				{/if}
			</figcaption>
		</figure>
	{/if}

	{#if item && onretake}
		<div class="current-photo">
			{#if item.photoId}
				<button
					class="photo-button"
					type="button"
					aria-label="Photo of the label"
					onclick={onphoto}
				>
					{#key item.photoId}
						<PhotoImage photoId={item.photoId} size="thumb" alt="" />
					{/key}
				</button>
			{/if}
			<button class="btn" type="button" onclick={() => (camera = 'label')}>
				{item.photoId ? 'Retake photo' : 'Add a photo'}
			</button>
		</div>
	{/if}

	<div class="rows">
		<div class="line" class:needs-check={unread.description && !description}>
			<label for="{uid}-description">Description</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="{uid}-description"
				class="input value"
				bind:value={description}
				oninput={() => (touched.description = true)}
				autocomplete="off"
				autofocus={!item && !capture}
				aria-describedby={unread.description && !description
					? `${uid}-description-check`
					: undefined}
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

		<div class="line" class:needs-check={unread.price && !price}>
			<label for="{uid}-price">{amountLabel('Unit price', currency)}</label>
			<input
				id="{uid}-price"
				class="input value price"
				bind:value={price}
				oninput={() => {
					touched.price = true;
					priceChecked = false;
				}}
				inputmode="decimal"
				placeholder={minorToInput(0)}
				aria-invalid={price !== '' && unitPriceMinor === null}
				aria-describedby={unread.price && !price ? `${uid}-price-check` : undefined}
			/>
			{#if unread.price && !price}
				<p class="check-hint" id="{uid}-price-check">Couldn't read the price. Please type it.</p>
			{:else if priceChecked}
				<p class="checked-hint">✓ Matches the unit price on the label</p>
			{/if}
			{#if perUnit}
				<p class="lookup-hint">Label unit price: {perUnit}</p>
			{/if}
		</div>

		<div class="line">
			<span id="{uid}-qty-label">Quantity</span>
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

		<div class="line">
			<span aria-hidden="true">Tax</span>
			<button
				class="pill"
				type="button"
				role="switch"
				aria-checked={priceIncludesTax}
				aria-label="Price includes tax"
				onclick={() => {
					priceIncludesTax = !priceIncludesTax;
					touched.vat = true;
				}}
			>
				{priceIncludesTax ? 'Includes tax' : 'Excludes tax'}
			</button>
		</div>

		<div class="line">
			<span aria-hidden="true">Multi-buy</span>
			<button
				class="pill"
				type="button"
				role="switch"
				aria-checked={offerOn}
				aria-label="Multi-buy offer"
				aria-controls="{uid}-offer"
				onclick={() => {
					offerOn = !offerOn;
					touched.offer = true;
				}}
			>
				{offerOn ? 'Offer on' : 'None'}
			</button>
			{#if offerOn}
				<div class="offer" id="{uid}-offer" role="group" aria-label="Offer: items and price">
					<input
						class="input"
						aria-label="Offer: number of items"
						bind:value={offerQuantity}
						oninput={() => (touched.offer = true)}
						inputmode="numeric"
						placeholder="2"
					/>
					<span>for {currencySymbol(currency)}</span>
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
			{/if}
		</div>

		<div class="line">
			<label for="{uid}-barcode">Barcode <span class="visually-hidden">(optional)</span></label>
			<div class="barcode">
				<input
					id="{uid}-barcode"
					class="input value"
					bind:value={barcode}
					oninput={() => (touched.barcode = true)}
					inputmode="numeric"
					autocomplete="off"
				/>
				<button class="btn" type="button" onclick={() => (camera = 'barcode')}>Scan</button>
			</div>
		</div>
	</div>

	{#if preview}
		<p class="preview">
			Line total {formatMoney(preview.inclMinor, currency)} incl. tax · {formatMoney(
				preview.exclMinor,
				currency
			)} excl.
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

	.photo-button {
		padding: 0;
		border: none;
		background: transparent;
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

	/* Label on the left, value on the right, a hairline between rows. */
	.rows {
		margin-bottom: 16px;
		border-top: 1px solid var(--border);
	}

	.line {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		align-items: center;
		column-gap: 12px;
		min-height: 60px;
		padding: 6px 0;
		border-bottom: 1px solid var(--border);
	}

	.line > label,
	.line > span {
		color: var(--muted);
		white-space: nowrap;
	}

	.line > :nth-child(2) {
		justify-self: end;
	}

	/* Hints, and the offer's boxes, run under the row. */
	.line > p,
	.line > .offer {
		grid-column: 1 / -1;
		justify-self: stretch;
		text-align: right;
	}

	.line > p {
		margin-top: 2px;
	}

	/* The value reads as text, and shows as a box only while it is being typed in. */
	.value {
		border-color: transparent;
		background: transparent;
		padding: 0 8px;
		text-align: right;
		font-weight: 700;
		text-overflow: ellipsis;
	}

	.value:hover,
	.value:focus {
		border-color: var(--control-border);
	}

	.price {
		max-width: 9rem;
		font-variant-numeric: tabular-nums;
	}

	.pill {
		min-height: 36px;
		padding: 0 14px;
		border: none;
		border-radius: 10px;
		background: var(--surface-2);
		color: var(--muted);
		font-weight: 700;
	}

	.pill[aria-checked='true'] {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.offer {
		display: grid;
		grid-template-columns: 4rem auto 6rem;
		justify-content: end;
		align-items: center;
		gap: 8px;
		margin: 4px 0;
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 12px;
		border-radius: 999px;
		background: var(--success-bg);
		color: var(--success-text);
		font-weight: 600;
	}

	.chip svg {
		width: 16px;
		height: 16px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.25;
		stroke-linecap: round;
		stroke-linejoin: round;
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
		grid-template-columns: minmax(0, 12rem) auto;
		align-items: center;
		gap: 8px;
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
