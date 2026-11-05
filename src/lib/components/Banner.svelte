<script lang="ts">
	import type { Snippet } from 'svelte';
	import { toast } from '#lib/toast.svelte.ts';

	interface Props {
		/** Names the banner for screen readers. */
		label: string;
		icon: Snippet;
		children: Snippet;
		/** The main button, then Later. */
		actions: Snippet;
	}

	let { label, icon, children, actions }: Props = $props();
	let card: HTMLElement;

	// A toast that shows while the banner is up goes above it, not over it.
	$effect(() => {
		void toast.lift;
		// Where it rests: offsetTop leaves out the rise it shows with.
		const measure = () => (toast.below = innerHeight - card.offsetTop);
		const observer = new ResizeObserver(measure);
		observer.observe(card);
		window.addEventListener('resize', measure);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', measure);
			toast.below = 0;
		};
	});
</script>

<!-- A card at the bottom of the screen that stays until it is answered. -->
<aside
	bind:this={card}
	class="banner"
	aria-label={label}
	style:bottom={toast.lift ? `${toast.lift + 8}px` : undefined}
>
	<span class="icon" aria-hidden="true">{@render icon()}</span>
	<p role="status">{@render children()}</p>
	<div class="actions">{@render actions()}</div>
</aside>

<style>
	.banner {
		position: fixed;
		inset: auto var(--gutter) calc(12px + env(safe-area-inset-bottom));
		z-index: 10;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 12px;
		max-width: 528px;
		margin: 0 auto;
		padding: 12px 12px 12px 14px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: 0 6px 20px rgb(17 24 39 / 0.18);
		animation: rise 0.2s ease;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.banner {
			animation: none;
		}
	}

	.icon {
		display: grid;
		place-items: center;
		flex: none;
		width: 40px;
		height: 40px;
		border-radius: 12px;
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.icon :global(svg) {
		width: 22px;
		height: 22px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	p {
		flex: 1 1 12rem;
		margin: 0;
		font-weight: 600;
	}

	.actions {
		display: flex;
		gap: 8px;
		margin-left: auto;
	}

	.actions :global(.btn) {
		min-height: 40px;
		padding: 0 14px;
	}
</style>
