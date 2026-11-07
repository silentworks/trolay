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
				<span class="tax">
					{formatPercent(store.taxRateBps)}% sales tax · shelf prices {store.pricesIncludeTax
						? 'incl.'
						: 'excl.'}
					tax
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
		gap: var(--space-2);
	}

	button {
		display: grid;
		width: 100%;
		min-height: calc(var(--tap) + 16px * var(--density));
		padding: var(--space-3) 16px;
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
	.tax {
		color: var(--muted);
		font-size: 0.9rem;
	}
</style>
