<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Store } from '#lib/data/db.ts';
	import { addStore, listStores, type StoreInput } from '#lib/data/stores.ts';
	import { startTrip } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import AppHeader from './AppHeader.svelte';
	import NoStores from './NoStores.svelte';
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
			<NoStores
				line="Add the store you're in to start your first trip."
				onadd={() => (addingStore = true)}
			/>
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
