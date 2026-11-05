<script lang="ts">
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import StoreForm from '#lib/components/StoreForm.svelte';
	import StoreList from '#lib/components/StoreList.svelte';
	import type { Store } from '#lib/data/db.ts';
	import {
		addStore,
		deleteStore,
		listStores,
		restoreStore,
		updateStore,
		type StoreInput
	} from '#lib/data/stores.ts';
	import { db, isLive } from '#lib/data/db.ts';
	import { tripsSharedWithMe } from '#lib/sharing/ownership.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { purgeDeletedPhotos } from '#lib/data/trips.ts';
	import { toast } from '#lib/toast.svelte.ts';

	const stores = new LiveQuery(() => listStores());
	let editing = $state<Store | null>(null);
	let adding = $state(false);
	let deleting = $state<Store | null>(null);

	async function saveEdit(input: StoreInput) {
		if (!editing) return;
		await updateStore(editing.id, input);
		editing = null;
	}

	async function saveNew(input: StoreInput) {
		await addStore(input);
		adding = false;
	}

	async function remove(withHistory: boolean) {
		if (!deleting) return;
		try {
			const trips = (await db.trips.where('storeId').equals(deleting.id).toArray()).filter(isLive);
			if ((await tripsSharedWithMe(trips.map((trip) => trip.id))).size) {
				throw new Error('This store was shared with you, so only its owner can delete it.');
			}
			const store = deleting;
			await deleteStore(store.id, withHistory);
			deleting = null;
			toast.show({
				message: `Deleted ${store.name}${store.branch ? ` · ${store.branch}` : ''}`,
				action: { label: 'Undo', run: () => void restoreStore(store.id) },
				ondone: () => void purgeDeletedPhotos()
			});
		} catch (error) {
			deleting = null;
			toast.error(error);
		}
	}
</script>

<svelte:head>
	<title>Stores · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="Stores" back={{ href: resolve('/'), label: 'Trolley' }} />

	{#if stores.loaded}
		{#if stores.current?.length}
			<p class="hint">Tap a store to edit its name, branch, currency or sales tax.</p>
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
		<button
			class="btn btn-danger btn-block remove"
			type="button"
			onclick={() => {
				deleting = editing;
				editing = null;
			}}
		>
			Delete store
		</button>
	{/if}
</Sheet>

<Sheet open={deleting !== null} title="Delete store?" onclose={() => (deleting = null)}>
	{#if deleting}
		<p>
			Delete {deleting.name}{deleting.branch ? ` · ${deleting.branch}` : ''}? Past trips there stay
			in History as "Deleted store" unless you delete them too.
		</p>
		<div class="choices">
			<button class="btn btn-danger btn-block" type="button" onclick={() => remove(false)}>
				Delete store, keep history
			</button>
			<button class="btn btn-danger btn-block" type="button" onclick={() => remove(true)}>
				Delete store and its history
			</button>
		</div>
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

	.remove {
		margin-top: 16px;
	}

	.choices {
		display: grid;
		gap: 8px;
	}

	.add {
		margin-top: 16px;
	}
</style>
