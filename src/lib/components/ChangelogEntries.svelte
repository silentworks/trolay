<script lang="ts">
	import { releaseDate, SECTIONS, type ChangelogEntry } from '#lib/changelog.ts';

	interface Props {
		entries: ChangelogEntry[];
		/** The heading level of each release; its sections are one level below. */
		level: 2 | 3;
	}

	let { entries, level }: Props = $props();
</script>

{#each entries as entry (entry.version)}
	<section class="release">
		<svelte:element this={`h${level}`} class="date">
			{releaseDate(entry.version)}
			<span class="version">{entry.version}</span>
		</svelte:element>
		{#each SECTIONS as { key, title } (key)}
			{@const lines = entry[key]}
			{#if lines?.length}
				<svelte:element this={`h${level + 1}`} class="section {key}">{title}</svelte:element>
				<ul>
					{#each lines as line (line)}<li>{line}</li>{/each}
				</ul>
			{/if}
		{/each}
	</section>
{/each}

<style>
	.release + .release {
		margin-top: 20px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	.date {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px 12px;
		margin: 0 0 8px;
		font-size: 1.05rem;
	}

	.version {
		color: var(--muted);
		font-size: 0.82rem;
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}

	.section {
		display: inline-block;
		margin: 10px 0 6px;
		padding: 2px 10px;
		border-radius: 999px;
		font-size: 0.8rem;
		font-weight: 700;
		background: var(--surface-2);
		color: var(--muted);
	}

	.added {
		background: var(--success-bg);
		color: var(--success-text);
	}

	.changed,
	.fixed {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	ul {
		display: grid;
		gap: 6px;
		margin: 0;
		padding-left: 20px;
	}

	li {
		line-height: 1.4;
	}
</style>
