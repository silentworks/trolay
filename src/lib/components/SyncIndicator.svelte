<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { syncMessage } from '#lib/sync/message.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';

	// Long enough to see the arrows turn, even when a round is over in a moment.
	const MIN_SPIN_MS = 700;
	// How long the green tick stays once a round has finished.
	const DONE_MS = 2000;
	// How long the tick takes to fade away (the opacity transition below).
	const LEAVE_MS = 300;

	interface Props {
		/** Offline: the header shows the offline icon in this slot, so this one stays out of sight. */
		offline?: boolean;
	}

	let { offline = false }: Props = $props();

	/**
	 * spin: a round is running; done: one has just finished, with a tick; leaving: the tick fading
	 * away; rest: neither, and the icon is hidden unless the last round failed.
	 */
	let phase = $state<'rest' | 'spin' | 'done' | 'leaving'>('rest');
	let spunAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const status = syncEngine.status;
		untrack(() => {
			if (status === 'syncing') {
				clearTimeout(timer);
				if (phase !== 'spin') spunAt = Date.now();
				phase = 'spin';
			} else if (phase === 'spin') {
				const ok = status === 'synced';
				// Only the latest ending counts, if the status moves on more than once.
				clearTimeout(timer);
				timer = setTimeout(
					() => {
						if (!ok) return (phase = 'rest');
						phase = 'done';
						timer = setTimeout(() => {
							phase = 'leaving';
							timer = setTimeout(() => (phase = 'rest'), LEAVE_MS);
						}, DONE_MS);
					},
					Math.max(0, MIN_SPIN_MS - (Date.now() - spunAt))
				);
			}
		});
	});

	$effect(() => () => clearTimeout(timer));

	/** A failed round keeps the icon up, in red, until a round goes through (even with no signal). */
	const failed = $derived(syncEngine.failed && phase === 'rest');
	const shown = $derived(!offline && ((phase !== 'rest' && phase !== 'leaving') || failed));

	const message = $derived(syncMessage(syncEngine));
</script>

{#if syncEngine.status !== 'off'}
	<!--
		Always in the header while signed in, so the title never moves; hidden (and out of reach of
		taps, Tab and screen readers) while nothing is happening.
	-->
	<a
		class="sync"
		class:shown
		href={resolve('/settings/account')}
		data-phase={phase}
		data-failed={failed || undefined}
		aria-label="Sync details"
	>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<g class="arrows">
				<path d="M4.48 9.26A8 8 0 0 1 18.13 6.86" />
				<path class="head" d="M20.05 9.17 19.82 5.45 16.44 8.27Z" />
				<g class="flip">
					<path d="M4.48 9.26A8 8 0 0 1 18.13 6.86" />
					<path class="head" d="M20.05 9.17 19.82 5.45 16.44 8.27Z" />
				</g>
			</g>
			<circle class="ring" cx="12" cy="12" r="8" />
			<circle class="disc" cx="12" cy="12" r="10" />
			<path class="tick" d="m7.5 12.3 3 3 6-6.3" pathLength="1" />
		</svg>
		{#if failed}<span class="badge" aria-hidden="true">!</span>{/if}
	</a>
	<!-- Beside the icon, not in it, so changes are still read out while it's hidden. -->
	<span class="visually-hidden" role="status">{message}</span>
{/if}

<style>
	/*
	 * A small icon, the size of the title's text, in a slot 36px wide; the tap reaches 4px either
	 * side, to 44px, without crowding the title.
	 */
	.sync {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 36px;
		height: var(--tap);
		color: var(--muted);
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 0.3s ease,
			visibility 0s 0.3s;
	}

	.sync::before {
		content: '';
		position: absolute;
		inset: 0 -4px;
	}

	.sync.shown {
		opacity: 1;
		visibility: visible;
		transition: opacity 0.15s ease;
	}

	svg {
		width: 18px;
		height: 18px;
		overflow: visible;
	}

	.arrows,
	.flip,
	.disc {
		transform-origin: 12px 12px;
	}

	/* The second arrow is the first turned half way round. */
	.flip {
		rotate: 0.5turn;
	}

	.arrows path {
		fill: none;
		stroke: currentColor;
		stroke-width: 2.4;
		stroke-linecap: round;
	}

	.arrows .head {
		fill: currentColor;
		stroke-width: 1;
		stroke-linejoin: round;
	}

	.arrows {
		transition:
			opacity 0.2s ease,
			scale 0.2s ease;
	}

	.ring {
		fill: none;
		stroke: var(--accent);
		stroke-width: 2.4;
		opacity: 0;
	}

	.disc {
		fill: var(--success);
		scale: 0;
	}

	.tick {
		fill: none;
		stroke: var(--on-success);
		stroke-width: 2.8;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
	}

	/* Syncing: the arrows turn, in the accent colour. */
	.sync[data-phase='spin'] {
		color: var(--accent);
	}

	.sync[data-phase='spin'] .arrows {
		animation: turn 0.9s linear infinite;
	}

	@keyframes turn {
		to {
			rotate: 1turn;
		}
	}

	/*
	 * Done: the arrows close into a ring that turns green, fills, and a tick is drawn on it; it then
	 * fades away (leaving) as it is.
	 */
	.sync:is([data-phase='done'], [data-phase='leaving']) .arrows {
		opacity: 0;
		scale: 0.9;
	}

	.sync:is([data-phase='done'], [data-phase='leaving']) .ring {
		animation: close 0.45s ease forwards;
	}

	.sync:is([data-phase='done'], [data-phase='leaving']) .disc {
		animation: fill 0.25s 0.4s ease-out forwards;
	}

	.sync:is([data-phase='done'], [data-phase='leaving']) .tick {
		animation: draw 0.3s 0.6s ease-out forwards;
	}

	@keyframes close {
		0% {
			opacity: 1;
			stroke: var(--accent);
		}
		100% {
			opacity: 1;
			stroke: var(--success);
		}
	}

	@keyframes fill {
		to {
			scale: 1;
		}
	}

	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}

	/* The last round failed: red, with a "!", until one goes through. */
	.sync[data-failed] {
		color: var(--danger);
	}

	.badge {
		position: absolute;
		top: calc(50% - 15px);
		right: 2px;
		display: grid;
		place-items: center;
		min-width: 11px;
		height: 11px;
		border-radius: 999px;
		border: 2px solid var(--bg);
		box-sizing: content-box;
		background: var(--danger);
		color: #fff;
		font-size: 8px;
		font-weight: 800;
		line-height: 1;
	}

	/* Animations off (src/lib/appearance.ts): no turning, and the tick shows at once. */
	:global(:root[data-motion='reduce']) .sync[data-phase='spin'] .arrows {
		animation: none;
	}

	:global(:root[data-motion='reduce']) .sync:is([data-phase='done'], [data-phase='leaving']) .ring {
		animation: none;
		opacity: 1;
		stroke: var(--success);
	}

	:global(:root[data-motion='reduce'])
		.sync:is([data-phase='done'], [data-phase='leaving'])
		:is(.disc, .tick) {
		animation: none;
		scale: 1;
		stroke-dashoffset: 0;
	}
</style>
