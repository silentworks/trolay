<script lang="ts">
	import { resolve } from '$app/paths';
	import { CHANGELOG } from '#lib/changelog.ts';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import ChangelogEntries from '#lib/components/ChangelogEntries.svelte';
</script>

<svelte:head>
	<title>What's new · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="What's new" back={{ href: resolve('/settings/about'), label: 'About' }} />
	<div class="card">
		<ChangelogEntries entries={CHANGELOG} level={2} />
	</div>
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.card {
		padding: 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}
</style>
