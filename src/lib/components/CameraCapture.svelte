<script lang="ts">
	import { detectBarcode, detectBarcodeInPhoto } from '#lib/capture/barcode.ts';
	import {
		cameraErrorMessage,
		canUseCamera,
		cropUnder,
		grabFrame,
		openRearCamera,
		stopCamera
	} from '#lib/capture/camera.ts';

	interface Props {
		open: boolean;
		/**
		 * label: snap a shelf label (any barcode in view comes along); receipt: snap the bottom of a
		 * till receipt; barcode: scan only.
		 */
		mode: 'label' | 'receipt' | 'barcode';
		/** Label and receipt modes: the photo, and (label) a barcode if one was seen while aiming. */
		oncapture?: (photo: Blob, barcode: string | undefined) => void;
		/** Barcode mode: the barcode that was read. */
		onbarcode?: (barcode: string) => void;
		onclose: () => void;
	}

	let { open, mode, oncapture, onbarcode, onclose }: Props = $props();

	const SCAN_INTERVAL_MS = 250;
	const TITLES = {
		label: 'Snap a shelf label',
		receipt: 'Snap the receipt',
		barcode: 'Scan a barcode'
	};

	let dialog: HTMLDialogElement;
	let video = $state<HTMLVideoElement>();
	let fileInput = $state<HTMLInputElement>();
	let guide = $state<HTMLElement>();
	let status = $state<'starting' | 'live' | 'unavailable'>('starting');
	let problem = $state('');
	let barcode = $state<string>();
	let busy = $state(false);

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});

	// The camera runs only while the dialog is open.
	$effect(() => {
		if (!open || !video) return;
		const element = video;
		let stream: MediaStream | undefined;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		status = 'starting';
		problem = '';
		barcode = undefined;

		const scan = async () => {
			if (stopped || mode === 'receipt') return;
			try {
				if (element.readyState >= element.HAVE_CURRENT_DATA) {
					const found = await detectBarcode(element);
					if (found && !stopped) {
						barcode = found;
						if (mode === 'barcode') {
							onbarcode?.(found);
							return;
						}
					}
				}
			} catch (error) {
				// Scanning is a bonus while snapping a label; never block the photo on it.
				console.warn('Barcode scan failed:', error);
			}
			timer = setTimeout(scan, SCAN_INTERVAL_MS);
		};

		(async () => {
			if (!canUseCamera()) {
				status = 'unavailable';
				problem = 'This browser cannot open the camera inside the app.';
				return;
			}
			try {
				stream = await openRearCamera();
				if (stopped) return stopCamera(stream);
				element.srcObject = stream;
				await element.play();
				status = 'live';
				scan();
			} catch (error) {
				status = 'unavailable';
				problem = cameraErrorMessage(error);
			}
		})();

		return () => {
			stopped = true;
			clearTimeout(timer);
			stopCamera(stream);
			element.srcObject = null;
		};
	});

	async function snap() {
		if (!video || busy) return;
		busy = true;
		try {
			// Only what is inside the guide (and a margin) is kept: neighbouring labels and pack
			// text outside it can only confuse the reader.
			const photo = await grabFrame(video, guide ? cropUnder(video, guide) : undefined);
			oncapture?.(photo, barcode);
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	async function picked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (mode !== 'barcode') {
			oncapture?.(file, barcode);
			return;
		}
		busy = true;
		try {
			const found = await detectBarcodeInPhoto(file);
			if (found) onbarcode?.(found);
			else problem = 'No barcode found in that photo. Try again closer, or type it in.';
		} catch {
			problem = 'The barcode reader could not be loaded.';
		} finally {
			busy = false;
		}
	}
</script>

<dialog bind:this={dialog} class="camera" aria-label={TITLES[mode]} {onclose}>
	{#if open}
		<video bind:this={video} playsinline muted autoplay class:hidden={status !== 'live'}></video>

		{#if status === 'live'}
			<div class="guide {mode}" aria-hidden="true" bind:this={guide}></div>
		{/if}

		<header>
			<button
				class="btn round"
				type="button"
				aria-label="Close camera"
				onclick={() => dialog.close()}>✕</button
			>
			<p class="hint" aria-live="polite">
				{#if status === 'starting'}
					Starting the camera…
				{:else if status === 'unavailable'}
					{problem}
				{:else if mode === 'label'}
					Fill the frame with the shelf label
				{:else if mode === 'receipt'}
					Fit the bottom of the receipt, with the total, in the frame
				{:else}
					Point at the barcode
				{/if}
			</p>
		</header>

		{#if status === 'unavailable'}
			<div class="fallback">
				<p>You can take the photo with your camera app instead.</p>
				<button class="btn btn-primary" type="button" onclick={() => fileInput?.click()}>
					{mode === 'barcode' ? 'Photograph the barcode' : 'Take or choose a photo'}
				</button>
			</div>
		{/if}

		<footer>
			{#if barcode && mode === 'label'}
				<p class="chip" role="status">Barcode {barcode} ✓</p>
			{/if}
			{#if problem && status === 'live'}
				<p class="chip error-chip" role="alert">{problem}</p>
			{/if}
			<div class="controls">
				<button class="btn side" type="button" onclick={() => fileInput?.click()} disabled={busy}>
					Choose photo
				</button>
				{#if mode !== 'barcode'}
					<button
						class="shutter"
						type="button"
						aria-label="Take photo"
						disabled={status !== 'live' || busy}
						onclick={snap}
					></button>
				{/if}
				<span class="side" aria-hidden="true"></span>
			</div>
		</footer>

		<input
			bind:this={fileInput}
			class="visually-hidden"
			type="file"
			accept="image/*"
			capture="environment"
			tabindex="-1"
			aria-hidden="true"
			onchange={picked}
		/>
	{/if}
</dialog>

<style>
	dialog.camera {
		width: 100vw;
		max-width: none;
		height: 100dvh;
		max-height: none;
		margin: 0;
		padding: 0;
		border: none;
		background: #000;
		color: #fff;
	}

	dialog.camera::backdrop {
		background: #000;
	}

	video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	video.hidden {
		visibility: hidden;
	}

	/* Darkens everything outside the frame the label should fill. */
	.guide {
		position: absolute;
		left: 6%;
		right: 6%;
		top: 50%;
		translate: 0 -55%;
		border: 3px solid rgb(255 255 255 / 0.9);
		border-radius: 16px;
		box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.35);
		pointer-events: none;
	}

	.guide.label {
		aspect-ratio: 5 / 3;
	}

	/* The bottom of a till roll: narrow and tall. */
	.guide.receipt {
		left: 14%;
		right: 14%;
		aspect-ratio: 3 / 4;
	}

	.guide.barcode {
		aspect-ratio: 3 / 1;
	}

	header {
		position: absolute;
		inset: 0 0 auto;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: calc(12px + env(safe-area-inset-top)) var(--gutter) 12px;
		background: linear-gradient(rgb(0 0 0 / 0.6), transparent);
	}

	.hint {
		margin: 0;
		font-weight: 600;
	}

	.round {
		flex: none;
		width: var(--tap);
		border-radius: 50%;
		padding: 0;
		background: rgb(0 0 0 / 0.5);
		color: #fff;
		border-color: rgb(255 255 255 / 0.4);
	}

	.fallback {
		position: absolute;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 12px;
		padding: var(--gutter);
		text-align: center;
	}

	footer {
		position: absolute;
		inset: auto 0 0;
		display: grid;
		justify-items: center;
		gap: 12px;
		padding: 24px var(--gutter) calc(24px + env(safe-area-inset-bottom));
		background: linear-gradient(transparent, rgb(0 0 0 / 0.6));
	}

	.chip {
		margin: 0;
		padding: 6px 14px;
		border-radius: 999px;
		background: rgb(0 0 0 / 0.7);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.error-chip {
		background: var(--danger);
	}

	.controls {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		width: 100%;
		max-width: 420px;
	}

	.controls .side {
		justify-self: start;
		padding: 0 14px;
		white-space: nowrap;
		background: rgb(0 0 0 / 0.5);
		color: #fff;
		border-color: rgb(255 255 255 / 0.4);
	}

	.controls span.side {
		background: none;
	}

	.shutter {
		width: 76px;
		height: 76px;
		border-radius: 50%;
		border: 5px solid #fff;
		background: rgb(255 255 255 / 0.25);
		padding: 0;
	}

	.shutter:active:not(:disabled) {
		background: rgb(255 255 255 / 0.7);
	}

	.shutter:disabled {
		opacity: 0.4;
	}
</style>
