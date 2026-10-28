<script lang="ts">
	import { resolve } from '$app/paths';
	import type { Store } from '#lib/data/db.ts';
	import { addStore, listStores, type StoreInput } from '#lib/data/stores.ts';
	import { startTrip } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { parsePounds } from '#lib/money.ts';
	import Sheet from './Sheet.svelte';
	import StoreForm from './StoreForm.svelte';
	import StoreList from './StoreList.svelte';

	const stores = new LiveQuery(() => listStores());
	let budget = $state('');
	let error = $state('');
	let addingStore = $state(false);

	function readBudget(): number | undefined | null {
		if (!budget.trim()) return undefined;
		const minor = parsePounds(budget);
		return minor && minor > 0 ? minor : null;
	}

	async function begin(storeId: string) {
		const budgetMinor = readBudget();
		if (budgetMinor === null) {
			error = 'Enter a budget like 50 or 42.50, or leave it empty.';
			return;
		}
		error = '';
		try {
			await startTrip(storeId, budgetMinor);
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
	<header>
		<h1>Where are you shopping?</h1>
		<a class="btn btn-ghost" href={resolve('/stores')}>Stores</a>
	</header>

	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="field">
		<label for="trip-budget">Budget for this trip <span class="hint">(optional)</span></label>
		<input
			id="trip-budget"
			class="input"
			bind:value={budget}
			inputmode="decimal"
			placeholder="£"
			aria-invalid={readBudget() === null}
		/>
	</div>

	{#if stores.loaded}
		{#if stores.current?.length}
			<h2 class="section">Your stores</h2>
			<StoreList stores={stores.current} onpick={(store: Store) => begin(store.id)} />
		{:else}
			<p class="empty">Add the store you're in to start your first trip.</p>
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
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: var(--gutter);
		padding-bottom: calc(96px + env(safe-area-inset-bottom));
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin: 8px 0 20px;
	}

	h1 {
		font-size: 1.5rem;
	}

	.section {
		font-size: 1rem;
		color: var(--muted);
		margin: 8px 0;
	}

	.empty {
		color: var(--muted);
	}

	.hint {
		color: var(--muted);
		font-weight: 400;
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
