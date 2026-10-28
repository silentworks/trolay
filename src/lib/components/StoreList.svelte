<script lang="ts">
	import type { Store } from '#lib/data/db.ts';
	import { formatPercent } from '#lib/money.ts';

	interface Props {
		stores: Store[];
		currentId?: string;
		onpick: (store: Store) => void;
	}

	let { stores, currentId, onpick }: Props = $props();
</script>

<ul>
	{#each stores as store (store.id)}
		<li>
			<button
				type="button"
				onclick={() => onpick(store)}
				aria-current={store.id === currentId ? 'true' : undefined}
			>
				<span class="name">{store.name}</span>
				{#if store.branch}<span class="branch">{store.branch}</span>{/if}
				<span class="vat">
					{formatPercent(store.taxRateBps)}% VAT · labels {store.pricesIncludeTax
						? 'incl.'
						: 'excl.'}
					VAT
				</span>
			</button>
		</li>
	{/each}
</ul>

<style>
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}

	button {
		display: grid;
		width: 100%;
		min-height: 64px;
		padding: 12px 16px;
		text-align: left;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	button[aria-current='true'] {
		border-color: var(--accent);
		border-width: 2px;
	}

	.name {
		font-weight: 700;
		font-size: 1.05rem;
	}

	.branch,
	.vat {
		color: var(--muted);
		font-size: 0.9rem;
	}
</style>
