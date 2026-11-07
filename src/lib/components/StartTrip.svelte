<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Store } from '#lib/data/db.ts';
	import { addStore, listStores, type StoreInput } from '#lib/data/stores.ts';
	import { startTrip } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import AppHeader from './AppHeader.svelte';
	import Sheet from './Sheet.svelte';
	import StoreForm from './StoreForm.svelte';
	import StoreList from './StoreList.svelte';

	interface Props {
		/** Said once on arrival, e.g. that the owner of a shared trip ended it. */
		notice?: string;
	}

	let { notice }: Props = $props();

	const stores = new LiveQuery(() => listStores());
	let error = $state('');
	let addingStore = $state(false);

	async function begin(storeId: string) {
		error = '';
		try {
			await startTrip(storeId);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		}
	}

	async function addAndBegin(input: StoreInput) {
		const store = await addStore(input);
		addingStore = false;
		await begin(store.id);
	}
</script>

<div class="page">
	<AppHeader
		title="Trolay"
		sync
		menu={[
			{ label: 'History', href: resolve('/history') },
			{ label: 'Stores', href: resolve('/stores') },
			{ label: 'Account', href: resolve('/account') },
			{ label: 'Settings', href: resolve('/settings') }
		]}
	/>
	<h2 class="question">Where are you shopping?</h2>

	{#if notice}
		<p class="notice" role="status">{notice}</p>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	{#if stores.loaded}
		{#if stores.current?.length}
			<h2 class="section">Your stores</h2>
			<StoreList stores={stores.current} onpick={(store: Store) => begin(store.id)} />
		{:else}
			<!-- The whole card adds the first store, named as one sentence after the other. -->
			<button
				class="empty"
				type="button"
				aria-label="No stores yet. Add the store you're in to start your first trip."
				onclick={() => (addingStore = true)}
			>
				<span class="icon">
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M4 9.5 5.5 4h13L20 9.5" />
						<path d="M4 9.5a2.67 2.67 0 0 0 5.33 0 2.67 2.67 0 0 0 5.34 0 2.67 2.67 0 0 0 5.33 0" />
						<path d="M5.5 12.5V20h13v-7.5" />
						<path d="M10 20v-4.5h4V20" />
					</svg>
				</span>
				<span class="title">No stores yet</span>
				<span class="line">Add the store you're in to start your first trip.</span>
			</button>
		{/if}
	{/if}

	<div class="actions">
		<button class="btn btn-primary btn-block" type="button" onclick={() => (addingStore = true)}>
			Add a new store
		</button>
	</div>
</div>

<Sheet open={addingStore} title="New store" onclose={() => (addingStore = false)}>
	<StoreForm submitLabel="Add store and start trip" onsubmit={addAndBegin} />
</Sheet>

<style>
	.notice {
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--surface-2);
		font-weight: 600;
	}

	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter);
		padding-bottom: calc(96px + env(safe-area-inset-bottom));
	}

	.question {
		margin-bottom: 16px;
		font-size: 1.5rem;
	}

	.section {
		font-size: 1rem;
		color: var(--muted);
		margin: 8px 0;
	}

	/* No stores yet: a dashed card, all one button, that opens the New store sheet. */
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		width: 100%;
		margin-top: 8px;
		padding: 28px 20px;
		border: 2px dashed var(--control-border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--muted);
		font: inherit;
		text-align: center;
		cursor: pointer;
	}

	.empty .icon {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		margin-bottom: 6px;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	.empty svg {
		width: 28px;
		height: 28px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.empty .title {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text);
	}

	/* The primary action sits in the bottom third, within thumb reach. */
	.actions {
		position: fixed;
		inset: auto 0 0;
		padding: 12px var(--gutter) calc(12px + env(safe-area-inset-bottom));
		background: var(--bg);
		box-shadow: var(--shadow);
	}

	.actions .btn {
		max-width: 528px;
		margin: 0 auto;
		display: flex;
	}
</style>
