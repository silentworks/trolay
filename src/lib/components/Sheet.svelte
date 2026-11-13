<script lang="ts">
	import type { Snippet } from 'svelte';
	import ToastHost from './ToastHost.svelte';

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
			<button class="close" type="button" aria-label="Close" onclick={() => dialog.close()}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
			</button>
		</header>
		{#if open}
			{@render children()}
			<ToastHost inDialog />
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
		padding: var(--space-2) var(--gutter) calc(var(--space-4) + env(safe-area-inset-bottom));
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: var(--space-3);
	}

	h2 {
		font-size: 1.25rem;
	}

	/* A filled circle the thumb can find, lined up with the content's edge; the hit area reaches
	   8px further all round, 60px across. */
	.close {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 44px;
		height: 44px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--surface-2);
		color: var(--text);
	}

	.close::before {
		content: '';
		position: absolute;
		inset: -8px;
		border-radius: 50%;
	}

	.close svg {
		width: 22px;
		height: 22px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2.5;
		stroke-linecap: round;
	}
</style>
