<script lang="ts">
	import { toast, type ToastMessage } from '#lib/toast.svelte.ts';

	interface Props {
		/** Inside a modal dialog, which covers the screen's dock. */
		inDialog?: boolean;
	}

	let { inDialog = false }: Props = $props();

	const host = Symbol('toast host');
	let card: HTMLDivElement;
	// What the card shows. It keeps the last toast while it slides away.
	let shown = $state.raw<ToastMessage>();
	const active = $derived(toast.isActive(host));

	$effect(() => {
		const remove = toast.addHost(host);
		return () => {
			remove();
			toast.release('pointer');
			toast.release('focus');
		};
	});

	// Shown in the top layer, above the page and any sheet. Shown again for each new toast, which
	// also brings it back above a dialog opened since.
	$effect(() => {
		const current = active ? toast.current : null;
		if (current) {
			shown = current;
			if (card.matches(':popover-open')) card.hidePopover();
			card.showPopover();
		} else if (card.matches(':popover-open')) {
			card.hidePopover();
		}
	});
</script>

<div
	bind:this={card}
	class="toast"
	data-tone={shown?.tone}
	popover="manual"
	role="group"
	aria-label="Message"
	style:bottom={toast.lift && !inDialog ? `${toast.lift + 8}px` : undefined}
	onpointerenter={() => toast.hold('pointer')}
	onpointerleave={() => toast.release('pointer')}
	onfocusin={() => toast.hold('focus')}
	onfocusout={(event) => {
		if (!card.contains(event.relatedTarget as Node | null)) toast.release('focus');
	}}
>
	{#if shown}
		{#key shown.id}
			{#if shown.tone === 'success'}
				<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="12" r="9" />
					<path d="m8 12.5 2.75 2.75L16 10" />
				</svg>
			{:else if shown.tone === 'error'}
				<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 4 2.8 19.5h18.4z" />
					<path d="M12 10v4.5M12 17.2v.1" />
				</svg>
			{/if}
			<p role={shown.tone === 'error' ? 'alert' : 'status'}>{shown.message}</p>
			{#if shown.action}
				<button class="btn btn-ghost action" type="button" onclick={() => toast.act()}
					>{shown.action.label}</button
				>
			{/if}
			<button
				class="btn btn-ghost close"
				type="button"
				aria-label="Dismiss"
				onclick={() => toast.dismiss()}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
			</button>
		{/key}
	{/if}
</div>

<style>
	.toast {
		position: fixed;
		inset: auto var(--gutter) calc(12px + env(safe-area-inset-bottom));
		align-items: center;
		gap: 4px;
		width: auto;
		height: auto;
		max-width: 528px;
		margin: 0 auto;
		padding: 4px 4px 4px 14px;
		border: none;
		border-radius: var(--radius);
		background: var(--toast-bg);
		color: var(--toast-text);
		box-shadow: 0 6px 20px rgb(17 24 39 / 0.25);
		font-weight: 600;
		overflow: visible;
		/* It pops up from the bottom, and drops back down. */
		opacity: 0;
		transform: translateY(16px);
		transition:
			opacity 0.18s ease,
			transform 0.18s ease,
			overlay 0.18s allow-discrete,
			display 0.18s allow-discrete;
	}

	/* Only while open: a closed popover is hidden by the browser's own display: none. */
	.toast:popover-open {
		display: flex;
		opacity: 1;
		transform: none;
	}

	@starting-style {
		.toast:popover-open {
			opacity: 0;
			transform: translateY(16px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.toast,
		.toast:popover-open {
			transform: none;
		}
	}

	.toast[data-tone='error'] {
		background: var(--toast-error-bg);
		color: var(--toast-error-text);
	}

	p {
		flex: 1;
		margin: 0;
		padding: 6px 0;
	}

	svg {
		width: 22px;
		height: 22px;
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.icon {
		margin-right: 6px;
	}

	.toast[data-tone='success'] .icon {
		color: var(--toast-success);
	}

	.btn {
		color: inherit;
	}

	.action {
		padding: 0 12px;
		text-decoration: underline;
	}

	.close {
		padding: 0;
	}

	.close svg {
		width: 18px;
		height: 18px;
	}
</style>
