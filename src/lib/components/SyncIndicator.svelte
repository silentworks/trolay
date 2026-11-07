<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { syncMessage } from '#lib/sync/message.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';

	// Long enough to see the arrows turn, even when a round is over in a moment.
	const MIN_SPIN_MS = 700;
	// How long the green tick stays once a round has finished.
	const DONE_MS = 2000;

	/** spin: a round is running; done: one has just finished; rest: neither. */
	let phase = $state<'rest' | 'spin' | 'done'>('rest');
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
				timer = setTimeout(
					() => {
						phase = ok ? 'done' : 'rest';
						if (ok) timer = setTimeout(() => (phase = 'rest'), DONE_MS);
					},
					Math.max(0, MIN_SPIN_MS - (Date.now() - spunAt))
				);
			}
		});
	});

	$effect(() => () => clearTimeout(timer));

	const message = $derived(syncMessage(syncEngine));
</script>

{#if syncEngine.status !== 'off'}
	<a
		class="sync"
		href={resolve('/settings/account')}
		data-phase={phase}
		data-status={syncEngine.status}
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
		{#if syncEngine.status === 'pending' || syncEngine.status === 'error'}
			<span class="badge" aria-hidden="true">{syncEngine.status === 'error' ? '!' : ''}</span>
		{/if}
	</a>
	<span class="visually-hidden" role="status">{message}</span>
{/if}

<style>
	.sync {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		color: var(--muted);
	}

	svg {
		width: 24px;
		height: 24px;
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
		stroke-width: 2.2;
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
		stroke-width: 2.2;
		opacity: 0;
	}

	.disc {
		fill: var(--success);
		scale: 0;
	}

	.tick {
		fill: none;
		stroke: var(--on-success);
		stroke-width: 2.4;
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

	/* Done: the arrows close into a ring that turns green, fills, and a tick is drawn on it. */
	.sync[data-phase='done'] .arrows {
		opacity: 0;
		scale: 0.9;
	}

	.sync[data-phase='done'] .ring {
		animation: close 0.45s ease forwards;
	}

	.sync[data-phase='done'] .disc {
		animation: fill 0.25s 0.4s ease-out forwards;
	}

	.sync[data-phase='done'] .tick {
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

	/* No signal: greyed and struck through. */
	.sync[data-status='offline'] svg {
		opacity: 0.45;
	}

	.sync[data-status='offline']::after {
		content: '';
		position: absolute;
		width: 26px;
		height: 2.2px;
		border-radius: 2px;
		background: var(--muted);
		rotate: -45deg;
	}

	.sync[data-status='error'] {
		color: var(--danger);
	}

	/* Changes waiting (a dot), or a round that failed (!). */
	.badge {
		position: absolute;
		top: 4px;
		right: 3px;
		display: grid;
		place-items: center;
		min-width: 10px;
		height: 10px;
		border-radius: 999px;
		border: 2px solid var(--bg);
		box-sizing: content-box;
		background: var(--accent);
		color: var(--on-accent);
		font-size: 9px;
		font-weight: 800;
		line-height: 1;
	}

	.sync[data-status='error'] .badge {
		min-width: 12px;
		height: 12px;
		top: 2px;
		background: var(--danger);
		color: #fff;
	}

	/* Animations off (src/lib/appearance.ts). */
	:global(:root[data-motion='reduce']) .sync[data-phase='spin'] .arrows {
		animation: none;
	}

	:global(:root[data-motion='reduce']) .sync[data-phase='done'] .ring {
		animation: none;
	}

	:global(:root[data-motion='reduce']) .sync[data-phase='done'] .disc,
	:global(:root[data-motion='reduce']) .sync[data-phase='done'] .tick {
		animation: none;
		scale: 1;
		stroke-dashoffset: 0;
	}
</style>
