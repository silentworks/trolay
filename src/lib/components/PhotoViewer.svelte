<script lang="ts">
	import PhotoImage from './PhotoImage.svelte';

	interface Props {
		/** The photo to show, or undefined when closed. */
		photoId: string | undefined;
		title: string;
		onclose: () => void;
	}

	let { photoId, title, onclose }: Props = $props();
	let dialog: HTMLDialogElement;

	$effect(() => {
		if (photoId && !dialog.open) dialog.showModal();
		else if (!photoId && dialog.open) dialog.close();
	});
</script>

<!-- Full-screen photo; Escape, the close button or a tap anywhere closes it. -->
<dialog bind:this={dialog} aria-label={title} {onclose} onclick={() => dialog.close()}>
	<button class="btn close" type="button" aria-label="Close photo">✕</button>
	{#if photoId}
		<PhotoImage {photoId} size="full" alt={title} />
	{/if}
</dialog>

<style>
	dialog {
		width: 100vw;
		max-width: none;
		height: 100dvh;
		max-height: none;
		margin: 0;
		padding: calc(16px + env(safe-area-inset-top)) var(--gutter)
			calc(16px + env(safe-area-inset-bottom));
		border: none;
		background: #000;
	}

	dialog[open] {
		display: grid;
		place-items: center;
	}

	dialog::backdrop {
		background: #000;
	}

	.close {
		position: absolute;
		top: calc(12px + env(safe-area-inset-top));
		right: var(--gutter);
		border-radius: 50%;
		padding: 0;
		background: rgb(0 0 0 / 0.5);
		color: #fff;
		border-color: rgb(255 255 255 / 0.4);
	}
</style>
