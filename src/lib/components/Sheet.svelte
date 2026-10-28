<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		title: string;
		onclose: () => void;
		children: Snippet;
	}

	let { open, title, onclose, children }: Props = $props();
	const titleId = $props.id();
	let dialog: HTMLDialogElement;

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		else if (!open && dialog.open) dialog.close();
	});
</script>

<!-- A modal bottom sheet. Escape, the close button and a tap on the backdrop all close it. -->
<dialog
	bind:this={dialog}
	aria-labelledby={titleId}
	{onclose}
	onclick={(event) => {
		if (event.target === dialog) dialog.close();
	}}
>
	<div class="sheet">
		<header>
			<h2 id={titleId}>{title}</h2>
			<button class="btn btn-ghost" type="button" aria-label="Close" onclick={() => dialog.close()}
				>✕</button
			>
		</header>
		{#if open}
			{@render children()}
		{/if}
	</div>
</dialog>

<style>
	dialog {
		margin: auto auto 0;
		width: 100%;
		max-width: 560px;
		max-height: 92dvh;
		padding: 0;
		border: none;
		border-radius: 20px 20px 0 0;
		background: var(--surface);
		color: var(--text);
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 0.45);
	}

	.sheet {
		padding: 8px var(--gutter) calc(var(--gutter) + env(safe-area-inset-bottom));
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 12px;
	}

	h2 {
		font-size: 1.25rem;
	}
</style>
