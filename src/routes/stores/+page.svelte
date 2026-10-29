<script lang="ts">
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import StoreForm from '#lib/components/StoreForm.svelte';
	import StoreList from '#lib/components/StoreList.svelte';
	import type { Store } from '#lib/data/db.ts';
	import { addStore, listStores, updateStore, type StoreInput } from '#lib/data/stores.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';

	const stores = new LiveQuery(() => listStores());
	let editing = $state<Store | null>(null);
	let adding = $state(false);

	async function saveEdit(input: StoreInput) {
		if (!editing) return;
		await updateStore(editing.id, input);
		editing = null;
	}

	async function saveNew(input: StoreInput) {
		await addStore(input);
		adding = false;
	}
</script>

<svelte:head>
	<title>Stores · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="Stores" back={{ href: resolve('/'), label: 'Trolley' }} />

	{#if stores.loaded}
		{#if stores.current?.length}
			<p class="hint">Tap a store to edit its name, branch or VAT settings.</p>
			<StoreList stores={stores.current} onpick={(store) => (editing = store)} />
		{:else}
			<p class="hint">No stores yet.</p>
		{/if}
	{/if}

	<button class="btn btn-primary btn-block add" type="button" onclick={() => (adding = true)}>
		Add a new store
	</button>
</div>

<Sheet open={editing !== null} title="Edit store" onclose={() => (editing = null)}>
	{#if editing}
		<StoreForm store={editing} submitLabel="Save changes" onsubmit={saveEdit} />
	{/if}
</Sheet>

<Sheet open={adding} title="New store" onclose={() => (adding = false)}>
	<StoreForm submitLabel="Add store" onsubmit={saveNew} />
</Sheet>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.hint {
		color: var(--muted);
	}

	.add {
		margin-top: 16px;
	}
</style>
