<script lang="ts">
	import type { ChangelogEntry } from '#lib/changelog.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { appUpdate } from '#lib/update.svelte.ts';
	import Banner from './Banner.svelte';
	import WhatsNewSheet from './WhatsNewSheet.svelte';

	$effect(() => appUpdate.watch());

	// What the waiting version brings, when it can say.
	let news = $state<ChangelogEntry[]>([]);
	let reading = $state(false);
	$effect(() => {
		if (!appUpdate.available) return;
		let stale = false;
		appUpdate.changes().then((entries) => !stale && (news = entries));
		return () => (stale = true);
	});

	function closeNews() {
		reading = false;
		// Read here: not shown again once the new version opens.
		if (news.length) settings.markWhatsNewSeen(news[0].version);
	}
</script>

{#if appUpdate.available}
	<Banner label="App update">
		{#snippet icon()}
			<svg viewBox="0 0 24 24">
				<path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v4.5h-4.5" />
			</svg>
		{/snippet}
		A new version of Trolay is ready.
		{#if news.length}
			<button class="link" type="button" onclick={() => (reading = true)}>See what's new</button>
		{/if}
		{#snippet actions()}
			<button class="btn btn-primary" type="button" onclick={() => appUpdate.apply()}>
				Refresh to update
			</button>
			<button class="btn btn-ghost" type="button" onclick={() => appUpdate.dismiss()}>Later</button>
		{/snippet}
	</Banner>
{/if}

<WhatsNewSheet open={reading} entries={news} onclose={closeNews} />

<style>
	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
