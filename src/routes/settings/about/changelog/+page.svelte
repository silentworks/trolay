<script lang="ts">
	import { resolve } from '$app/paths';
	import { CHANGELOG } from '#lib/changelog.ts';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import ChangelogEntries from '#lib/components/ChangelogEntries.svelte';
	import SettingsGroup from '#lib/components/SettingsGroup.svelte';
</script>

<svelte:head>
	<title>What's new · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="What's new" back={{ href: resolve('/settings/about'), label: 'About' }} />
	<SettingsGroup padded>
		<ChangelogEntries entries={CHANGELOG} level={2} />
	</SettingsGroup>
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}
</style>
