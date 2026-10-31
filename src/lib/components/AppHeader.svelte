<script lang="ts">
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
		/** A round ← button on the left. */
		back?: { href: string; label: string };
		/** Entries for the ⋮ menu on the right. */
		menu?: MenuEntry[];
		/** Makes the title a button, named by titleLabel. */
		ontitle?: () => void;
		titleLabel?: string;
	}

	let { title, subtitle, back, menu, ontitle, titleLabel }: Props = $props();

	const menuId = $props.id();
	let open = $state(false);
	let toggle = $state<HTMLButtonElement>();
	let panel = $state<HTMLElement>();

	/** A tap anywhere outside the open menu, or on its button, closes it. */
	function tapOutside(event: PointerEvent) {
		const target = event.target as Node;
		if (!toggle?.contains(target) && !panel?.contains(target)) open = false;
	}

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
<header class="bar">
	{#if back}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass resolve()d paths -->
		<a class="round back" href={back.href} aria-label="Back to {back.label}">
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6" /></svg>
		</a>
	{/if}

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
				<circle cx="12" cy="5" r="1.8" />
				<circle cx="12" cy="12" r="1.8" />
				<circle cx="12" cy="19" r="1.8" />
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
</header>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 1;
		display: grid;
		grid-template-columns: var(--tap) minmax(0, 1fr) var(--tap);
		grid-template-areas: 'back title more';
		align-items: center;
		gap: 8px;
		margin: 0 calc(-1 * var(--gutter)) 16px;
		padding: calc(8px + env(safe-area-inset-top)) var(--gutter) 8px;
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		box-shadow: 0 4px 12px rgb(0 0 0 / 0.06);
	}

	.title {
		grid-area: title;
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
		background: var(--surface-2);
		color: var(--text);
	}

	.back {
		grid-area: back;
	}

	.more {
		grid-area: more;
	}

	.round svg {
		width: 22px;
		height: 22px;
		fill: currentColor;
	}

	.back svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
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
