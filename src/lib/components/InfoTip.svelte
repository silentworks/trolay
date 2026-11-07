<script lang="ts">
	import type { Snippet } from 'svelte';

	// An ⓘ button that opens a short explanation in a dark card pointing at it, for instructions
	// most people only need once. The card is a popover, so it sits above everything (a sheet
	// included), and the browser closes it on a tap elsewhere, on Escape, or when another opens.

	interface Props {
		/** The card's heading; also names the button ("About …"). */
		title: string;
		/** The button's accessible name, when "About <title>" doesn't read well. */
		label?: string;
		children: Snippet;
	}

	let { title, label = `About ${title.toLowerCase()}`, children }: Props = $props();

	const uid = $props.id();
	let button: HTMLButtonElement;
	let card: HTMLDivElement;
	let open = $state(false);
	/** Where the card goes, in viewport pixels, and where along it the arrow points. */
	let place = $state({ top: 0, left: 0, arrow: 0, above: false });

	const GAP = 10;
	const EDGE = 16;
	let lastHeight = 160;

	/** Below the button if it fits, else above; never past the screen's edges. */
	function position() {
		const at = button.getBoundingClientRect();
		// Before it opens the card has no size yet: its width is known from the stylesheet, and its
		// height is taken as the last one until it is open and can be measured.
		const width = card.offsetWidth || Math.min(320, innerWidth - 2 * EDGE);
		const height = card.offsetHeight || lastHeight;
		lastHeight = height;
		const middle = at.left + at.width / 2;
		const left = Math.min(Math.max(middle - width / 2, EDGE), innerWidth - EDGE - width);
		const above = at.bottom + GAP + height > innerHeight - EDGE && at.top - GAP - height > EDGE;
		place = {
			top: above ? at.top - GAP - height : at.bottom + GAP,
			left,
			arrow: Math.min(Math.max(middle - left, 20), width - 20),
			above
		};
	}

	// Placed before it shows, so it never flashes elsewhere; then again once it can be measured.
	function opening(event: ToggleEvent) {
		if (event.newState === 'open') position();
	}

	function toggled(event: ToggleEvent) {
		open = event.newState === 'open';
		if (open) position();
	}

	$effect(() => {
		if (!open) return;
		// The page can scroll or turn under an open card: it follows its button.
		const follow = () => position();
		addEventListener('resize', follow);
		addEventListener('scroll', follow, true);
		return () => {
			removeEventListener('resize', follow);
			removeEventListener('scroll', follow, true);
		};
	});
</script>

<button
	bind:this={button}
	class="info"
	type="button"
	popovertarget="{uid}-card"
	aria-label={label}
	aria-expanded={open}
>
	<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
		<circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" stroke-width="1.5" />
		<circle cx="12" cy="8" r="1.1" fill="currentColor" />
		<path d="M12 11v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
	</svg>
</button>

<div
	bind:this={card}
	id="{uid}-card"
	class="card"
	class:above={place.above}
	popover="auto"
	role="note"
	style:top="{place.top}px"
	style:left="{place.left}px"
	style:--arrow="{place.arrow}px"
	onbeforetoggle={opening}
	ontoggle={toggled}
>
	<p class="title">{title}</p>
	<div class="body">{@render children()}</div>
</div>

<style>
	.info {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: 44px;
		height: 44px;
		margin: -10px -8px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		vertical-align: middle;
		cursor: pointer;
	}

	.info[aria-expanded='true'],
	.info:hover {
		color: var(--text);
	}

	.card {
		position: fixed;
		inset: auto;
		margin: 0;
		width: min(320px, calc(100vw - 32px));
		padding: 18px 20px;
		border: 1px solid rgb(255 255 255 / 0.08);
		border-radius: 18px;
		background: var(--total-bg);
		color: var(--total-muted);
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.28);
		overflow: visible;
		font-size: 0.95rem;
		line-height: 1.45;
		/* Not what the label it sits beside has: it is a paragraph of its own. */
		text-align: left;
		white-space: normal;
	}

	/* The arrow, pointing at the button. */
	.card::before {
		content: '';
		position: absolute;
		top: -7px;
		left: calc(var(--arrow) - 7px);
		width: 14px;
		height: 14px;
		background: inherit;
		border-top: inherit;
		border-left: inherit;
		border-radius: 3px 0 0 0;
		transform: rotate(45deg);
	}

	.card.above::before {
		top: auto;
		bottom: -7px;
		transform: rotate(225deg);
	}

	.title {
		margin: 0 0 6px;
		color: var(--total-text);
		font-size: 1.05rem;
		font-weight: 700;
	}

	.body :global(p) {
		margin: 0;
	}

	.body :global(p + p) {
		margin-top: 8px;
	}
</style>
