<script lang="ts">
	import PhotoImage from './PhotoImage.svelte';
	import ToastHost from './ToastHost.svelte';

	interface Props {
		/** The photo to show, or undefined when closed. */
		photoId: string | undefined;
		title: string;
		onclose: () => void;
		/** Show the copy kept in the cloud when this phone has none. */
		cloud?: boolean;
	}

	let { photoId, title, onclose, cloud = false }: Props = $props();
	let dialog: HTMLDialogElement;
	let src = $state<string>();

	$effect(() => {
		if (photoId && !dialog.open) dialog.showModal();
		else if (!photoId && dialog.open) dialog.close();
	});
</script>

<!-- Full-screen photo; Escape, the close button or a tap anywhere but a toast closes it. -->
<dialog
	bind:this={dialog}
	aria-label={title}
	{onclose}
	onclick={(event) => {
		if (!(event.target as Element).closest('[popover]')) dialog.close();
	}}
>
	<button class="btn close" type="button" aria-label="Close photo">✕</button>
	{#if photoId}
		<PhotoImage {photoId} size="full" alt={title} {cloud} onshown={(shown) => (src = shown)} />
		{#if src}
			<!-- eslint-disable svelte/no-navigation-without-resolve -- a photo, not a page -->
			<a
				class="btn download"
				href={src}
				download="{title}.jpg"
				onclick={(event) => event.stopPropagation()}>Download</a
			>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
		<ToastHost inDialog />
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

	.download {
		position: absolute;
		bottom: calc(16px + env(safe-area-inset-bottom));
		left: 50%;
		transform: translateX(-50%);
		background: rgb(0 0 0 / 0.5);
		color: #fff;
		border-color: rgb(255 255 255 / 0.4);
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
