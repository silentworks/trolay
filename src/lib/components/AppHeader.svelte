<script lang="ts">
	import { connection } from '#lib/connection.svelte.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
	import OfflineIndicator from './OfflineIndicator.svelte';
	import SyncIndicator from './SyncIndicator.svelte';

	export interface MenuEntry {
		label: string;
		href?: string;
		onclick?: () => void;
		/** Set apart at the bottom of the menu, in the accent colour. */
		primary?: boolean;
		/** Destroys something: in the danger colour. */
		danger?: boolean;
	}

	interface Props {
		title: string;
		/** A smaller line under the title, such as a store's branch. */
		subtitle?: string;
		/** A round ‹ button on the left. */
		back?: { href: string; label: string };
		/** Entries for the ••• menu on the right. */
		menu?: MenuEntry[];
		/** Makes the title a button, named by titleLabel. */
		ontitle?: () => void;
		titleLabel?: string;
		/** A round History button before the menu. */
		history?: string;
		/** Title on the left, larger, as on the trolley; centred otherwise. */
		start?: boolean;
		/** The sync icon beside the title, while signed in. */
		sync?: boolean;
	}

	let {
		title,
		subtitle,
		back,
		menu,
		ontitle,
		titleLabel,
		history,
		start = false,
		sync = false
	}: Props = $props();

	const menuId = $props.id();
	let open = $state(false);
	let toggle = $state<HTMLButtonElement>();
	let panel = $state<HTMLElement>();

	/** A tap anywhere outside the open menu, or on its button, closes it. */
	function tapOutside(event: PointerEvent) {
		const target = event.target as Node;
		if (!toggle?.contains(target) && !panel?.contains(target)) open = false;
	}

	/** The sync icon's slot is there while signed in, on headers that ask for it. */
	const syncSlot = $derived(sync && syncEngine.status !== 'off');

	/**
	 * Read out going offline and coming back, unless the sync icon already says so. Empty at first,
	 * so opening a page offline says nothing until the connection changes.
	 */
	let announced = $state('');
	let wasOnline = connection.online;
	$effect(() => {
		const online = connection.online;
		if (online === wasOnline) return;
		wasOnline = online;
		announced = syncSlot ? '' : online ? 'Back online.' : "You're offline.";
	});

	function pick(entry: MenuEntry) {
		open = false;
		entry.onclick?.();
	}
</script>

<svelte:window
	onkeydown={(event) => event.key === 'Escape' && (open = false)}
	onpointerdown={tapOutside}
/>

<!--
	The header sits on its own surface, edge to edge. The side buttons take equal columns, so the
	title is centred on the screen even when only one side has a button.
-->
<header class="bar" class:start>
	{#if back}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass resolve()d paths -->
		<a class="round back" href={back.href} aria-label="Back to {back.label}">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6" /></svg>
		</a>
	{/if}

	<div class="heading">
		{#if ontitle}
			<button class="title" type="button" onclick={ontitle} aria-label={titleLabel}>
				<span class="name">{title}</span>
				{#if subtitle}<span class="sub">{subtitle}</span>{/if}
			</button>
		{:else}
			<div class="title">
				<h1 class="name">{title}</h1>
				{#if subtitle}<p class="sub">{subtitle}</p>{/if}
			</div>
		{/if}
		<!-- The sync icon and, in its place while offline, the offline icon: one slot, one spot. -->
		{#if syncSlot || !connection.online}
			<span class="slot">
				{#if sync}<SyncIndicator offline={!connection.online} />{/if}
				{#if !connection.online}<OfflineIndicator />{/if}
			</span>
		{/if}
		<!-- aria-live rather than role="status": it announces the same, and leaves the page's
			status messages as the only ones with that role. -->
		<span class="visually-hidden" aria-live="polite">{announced}</span>
	</div>

	{#if history || menu}
		<div class="side">
			{#if history}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass resolve()d paths -->
				<a class="round history" href={history} aria-label="History">
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
						<path d="M3 3v5h5" />
						<path d="M12 7v5l3 2" />
					</svg>
				</a>
			{/if}
			{#if menu}
				<button
					bind:this={toggle}
					class="round more"
					type="button"
					aria-label="Menu"
					aria-expanded={open}
					aria-controls={menuId}
					onclick={() => (open = !open)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<circle cx="5.5" cy="12" r="1.6" />
						<circle cx="12" cy="12" r="1.6" />
						<circle cx="18.5" cy="12" r="1.6" />
					</svg>
				</button>
				{#if open}
					<nav bind:this={panel} id={menuId} class="menu" aria-label="Menu">
						{#each menu as entry (entry.label)}
							{#if entry.href}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass resolve()d paths -->
								<a class:primary={entry.primary} href={entry.href} onclick={() => (open = false)}>
									{entry.label}
								</a>
							{:else}
								<button
									class:primary={entry.primary}
									class:danger={entry.danger}
									type="button"
									onclick={() => pick(entry)}
								>
									{entry.label}
								</button>
							{/if}
						{/each}
					</nav>
				{/if}
			{/if}
		</div>
	{/if}
</header>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: grid;
		grid-template-columns: minmax(var(--tap), max-content) minmax(0, 1fr) minmax(
				var(--tap),
				max-content
			);
		grid-template-areas: 'back title more';
		align-items: center;
		gap: 8px;
		margin: 0 calc(-1 * var(--gutter)) var(--space-3);
		padding: calc(var(--space-2) + env(safe-area-inset-top)) var(--gutter) var(--space-2);
		background: var(--bg);
	}

	/* The trolley: the store's name on the left, the buttons on the right. */
	.bar.start {
		grid-template-columns: minmax(0, 1fr) max-content;
		grid-template-areas: 'title more';
	}

	.bar.start .title {
		justify-items: start;
		text-align: left;
	}

	.bar.start .name {
		font-size: 1.45rem;
	}

	.side {
		grid-area: more;
		display: flex;
		gap: 8px;
		justify-content: end;
	}

	/* The title, and the sync icon beside it. */
	.heading {
		grid-area: title;
		min-width: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
	}

	.bar.start .heading {
		justify-content: start;
	}

	/* A centred title keeps to the middle: as much room before it as the icon slot after. */
	.bar:not(.start) .heading:has(> .slot)::before {
		content: '';
		flex: none;
		width: 36px;
	}

	/* The sync and offline icons share one place, stacked. */
	.slot {
		display: grid;
		flex: none;
	}

	.slot > :global(*) {
		grid-area: 1 / 1;
	}

	.title {
		min-width: 0;
		display: grid;
		justify-items: center;
		align-content: center;
		min-height: var(--tap);
		padding: 0;
		border: none;
		background: transparent;
		text-align: center;
		overflow-wrap: break-word;
	}

	.name {
		max-width: 100%;
		margin: 0;
		font-weight: 800;
		font-size: 1.2rem;
		line-height: 1.2;
	}

	.sub {
		max-width: 100%;
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}

	.round {
		display: grid;
		place-items: center;
		width: var(--tap);
		height: var(--tap);
		padding: 0;
		border: none;
		border-radius: 50%;
		background: var(--surface);
		/* Just enough to lift it off the page, in either theme. */
		box-shadow: 0 1px 3px rgb(17 24 39 / 0.08);
		color: var(--text);
	}

	.back {
		grid-area: back;
	}

	.round svg {
		width: 22px;
		height: 22px;
		fill: currentColor;
	}

	.back svg,
	.history svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	/* A small panel under the menu button, lined up with the right edge of the page. */
	.menu {
		position: fixed;
		z-index: 3;
		top: calc(env(safe-area-inset-top) + 60px);
		right: max(var(--gutter), (100vw - 560px) / 2 + var(--gutter));
		display: grid;
		width: max-content;
		min-width: 12rem;
		max-width: calc(100vw - 2 * var(--gutter));
		padding: 6px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
	}

	.menu a,
	.menu button {
		display: flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 14px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--text);
		font-weight: 600;
		text-align: left;
		text-decoration: none;
	}

	.menu a:hover,
	.menu button:hover {
		background: var(--surface-2);
	}

	.menu .danger {
		color: var(--danger);
	}

	.menu .primary {
		margin-top: 4px;
		border-top: 1px solid var(--border);
		border-radius: 0 0 8px 8px;
		color: var(--accent);
	}
</style>
