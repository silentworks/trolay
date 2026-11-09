<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { untrack } from 'svelte';
	import { readText } from '#lib/capture/ocr/browser.ts';
	import { parseReceipt } from '#lib/capture/receipt/parse.ts';
	import { isMismatch, looksLikeTaxAddedAtTill, receiptDifference } from '#lib/data/trips.ts';
	import { amountLabel, formatMoney, minorToInput, parsePounds } from '#lib/money.ts';
	import CameraCapture from './CameraCapture.svelte';

	interface Props {
		/** The app's total incl. tax: a till receipt always shows what was paid, tax included. */
		appTotalMinor: number;
		receiptTotalMinor?: number;
		photoCount: number;
		/** Saves the receipt total as it is typed, so it survives closing the sheet. */
		onreceipt: (receiptTotalMinor: number | undefined) => Promise<void>;
		onfinish: () => Promise<void>;
		/** The store's currency (ISO 4217); unset shows plain numbers. */
		currency?: string;
		/** The store's sales tax rate, for spotting a till that added tax the app didn't. */
		taxRateBps: number;
		/** The app already added tax on top of some prices, so the till adding it is no surprise. */
		taxAdded: boolean;
	}

	let {
		appTotalMinor,
		receiptTotalMinor,
		photoCount,
		onreceipt,
		onfinish,
		currency,
		taxRateBps,
		taxAdded
	}: Props = $props();
	const uid = $props.id();

	const initial = untrack(() => receiptTotalMinor);
	let value = $state(initial === undefined ? '' : minorToInput(initial));
	let busy = $state(false);
	let camera = $state(false);
	/** What reading a photo of the receipt came to, until the shopper edits the total. */
	let read = $state<'reading' | 'filled' | 'confirmed' | 'unreadable'>();

	const entered = $derived(value.trim() === '' ? undefined : parsePounds(value));
	const invalid = $derived(entered === null);
	const difference = $derived(receiptDifference(entered ?? undefined, appTotalMinor));
	const tillAddedTax = $derived(
		!taxAdded && looksLikeTaxAddedAtTill(difference, appTotalMinor, taxRateBps)
	);
	const keepPhotos = $derived(isMismatch(difference) && photoCount > 0);
	const photos = $derived(photoCount === 1 ? '1 label photo' : `${photoCount} label photos`);

	async function readReceipt(photo: Blob) {
		camera = false;
		read = 'reading';
		try {
			const reading = parseReceipt(await readText(photo));
			if (reading.totalMinor === undefined) {
				read = 'unreadable';
				return;
			}
			value = minorToInput(reading.totalMinor);
			read = reading.confirmedByPayment ? 'confirmed' : 'filled';
		} catch (error) {
			console.warn('Receipt reading failed:', error);
			read = 'unreadable';
		}
	}

	function save() {
		if (!invalid) onreceipt(entered ?? undefined).catch(() => {});
	}

	async function finish(event: SubmitEvent) {
		event.preventDefault();
		if (entered == null || busy) return;
		busy = true;
		try {
			await onreceipt(entered);
			await onfinish();
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={finish} novalidate>
	<dl class="sums">
		<div>
			<dt>Trolay total, incl. tax</dt>
			<dd>{formatMoney(appTotalMinor, currency)}</dd>
		</div>
	</dl>

	<div class="form-rows">
		<div class="form-row">
			<div class="with-info">
				<label for="{uid}-receipt">{amountLabel('Receipt total', currency)}</label>
				<InfoTip title="Receipt total">
					<p>
						The total printed on the till receipt. You need it to finish the trip, and Trolay checks
						it against its own total.
					</p>
				</InfoTip>
			</div>
			<input
				id="{uid}-receipt"
				class="input form-value amount"
				bind:value
				oninput={() => (read = undefined)}
				onchange={save}
				inputmode="decimal"
				autocomplete="off"
				placeholder={minorToInput(0)}
				aria-invalid={invalid}
				aria-describedby="{uid}-difference"
			/>
			{#if read === 'reading'}
				<p class="lookup-hint" role="status">Reading the receipt…</p>
			{:else if read === 'confirmed'}
				<p class="checked-hint" role="status">
					✓ Read from the photo, and the card and cash lines add up to it. Check it matches.
				</p>
			{:else if read === 'filled'}
				<p class="checked-hint" role="status">Read from the photo. Check it matches the receipt.</p>
			{:else if read === 'unreadable'}
				<p class="check-hint" role="status">Couldn't read the total. Please type it.</p>
			{/if}
		</div>
	</div>

	<button class="btn" type="button" disabled={read === 'reading'} onclick={() => (camera = true)}>
		📷 Read the receipt
	</button>

	<p class="difference" id="{uid}-difference" aria-live="polite" data-match={difference === 0}>
		{#if invalid}
			Enter the total like {minorToInput(4250)}.
		{:else if difference === undefined}
			Enter the receipt total to finish the trip. It checks the till charged what Trolay added up.
		{:else if difference === 0}
			✓ The receipt matches.
		{:else if difference > 0}
			The till charged {formatMoney(difference, currency)} more than Trolay added up.
			{#if tillAddedTax}
				Did the till add sales tax? If prices at this store don't include it, change the store's
				sales tax in Stores, and Trolay will add it on your next trip.
			{/if}
		{:else}
			The till charged {formatMoney(-difference, currency)} less than Trolay added up.
		{/if}
	</p>

	{#if photoCount > 0}
		<p class="photos" class:kept={keepPhotos}>
			{#if keepPhotos}
				The {photos} will be kept as evidence, so you can check the difference. Delete them from History
				when you are done.
			{:else}
				The {photos} will be deleted. Descriptions, prices and barcodes are kept.
			{/if}
		</p>
	{/if}

	<button
		class="btn btn-primary btn-block"
		type="submit"
		disabled={entered === undefined || invalid || busy || read === 'reading'}
	>
		Finish trip
	</button>
</form>

<CameraCapture
	open={camera}
	mode="receipt"
	oncapture={(photo) => readReceipt(photo)}
	onclose={() => (camera = false)}
/>

<style>
	form {
		display: grid;
		gap: 12px;
	}

	.sums {
		margin: 0;
	}

	.sums div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 1.1rem;
	}

	.sums dd {
		margin: 0;
		font-weight: 800;
		font-variant-numeric: tabular-nums;
	}

	/* The rows' own space below is taken by the form's gap. */
	.form-rows {
		margin: 0;
	}

	.amount {
		max-width: 9rem;
		font-variant-numeric: tabular-nums;
	}

	.difference {
		margin: 0;
		font-weight: 700;
		color: var(--warning-text);
	}

	.difference[data-match='true'] {
		color: var(--accent);
	}

	.photos {
		margin: 0;
		color: var(--muted);
	}

	.photos.kept {
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--warning-bg);
		color: var(--warning-text);
	}
</style>
