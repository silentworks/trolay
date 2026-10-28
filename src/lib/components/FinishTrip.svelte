<script lang="ts">
	import { untrack } from 'svelte';
	import { readText } from '#lib/capture/ocr/browser.ts';
	import { parseReceipt } from '#lib/capture/receipt/parse.ts';
	import { isMismatch, receiptDifference } from '#lib/data/trips.ts';
	import { formatGBP, minorToInput, parsePounds } from '#lib/money.ts';
	import CameraCapture from './CameraCapture.svelte';

	interface Props {
		/** The app's total incl. VAT: a till receipt always shows what was paid, VAT included. */
		appTotalMinor: number;
		receiptTotalMinor?: number;
		photoCount: number;
		/** Saves the receipt total as it is typed, so it survives closing the sheet. */
		onreceipt: (receiptTotalMinor: number | undefined) => Promise<void>;
		onfinish: () => Promise<void>;
	}

	let { appTotalMinor, receiptTotalMinor, photoCount, onreceipt, onfinish }: Props = $props();
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
		if (invalid || busy) return;
		busy = true;
		try {
			await onreceipt(entered ?? undefined);
			await onfinish();
		} finally {
			busy = false;
		}
	}
</script>

<form onsubmit={finish} novalidate>
	<dl class="sums">
		<div>
			<dt>Trolay total, incl. VAT</dt>
			<dd>{formatGBP(appTotalMinor)}</dd>
		</div>
	</dl>

	<div class="field">
		<label for="{uid}-receipt">Receipt total (£)</label>
		<input
			id="{uid}-receipt"
			class="input"
			bind:value
			oninput={() => (read = undefined)}
			onchange={save}
			inputmode="decimal"
			autocomplete="off"
			aria-invalid={invalid}
			aria-describedby="{uid}-difference"
		/>
		<span class="hint">The total on the till receipt. Optional.</span>
		{#if read === 'reading'}
			<p class="read" role="status">Reading the receipt…</p>
		{:else if read === 'confirmed'}
			<p class="read" role="status">
				✓ Read from the photo, and the card and cash lines add up to it. Check it matches.
			</p>
		{:else if read === 'filled'}
			<p class="read" role="status">Read from the photo. Check it matches the receipt.</p>
		{:else if read === 'unreadable'}
			<p class="read unreadable" role="status">Couldn't read the total. Please type it.</p>
		{/if}
		<button class="btn" type="button" disabled={read === 'reading'} onclick={() => (camera = true)}>
			📷 Read the receipt
		</button>
	</div>

	<p class="difference" id="{uid}-difference" aria-live="polite" data-match={difference === 0}>
		{#if invalid}
			Enter the total like 42.50.
		{:else if difference === undefined}
			Add the receipt total to check the till charged what Trolay added up.
		{:else if difference === 0}
			✓ The receipt matches.
		{:else if difference > 0}
			The till charged {formatGBP(difference)} more than Trolay added up.
		{:else}
			The till charged {formatGBP(-difference)} less than Trolay added up.
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
		disabled={invalid || busy || read === 'reading'}
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

	.field {
		margin: 0;
	}

	.read {
		margin: 0;
		color: var(--accent);
		font-size: 0.9rem;
	}

	.read.unreadable {
		color: var(--warning-text);
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
