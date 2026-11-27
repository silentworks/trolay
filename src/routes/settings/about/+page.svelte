<script lang="ts">
	import { version } from '$app/env';
	import { resolve } from '$app/paths';
	import { shortVersion } from '#lib/changelog.ts';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import SettingsGroup from '#lib/components/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/SettingsRow.svelte';
	import { formatWhen } from '#lib/dates.ts';

	// The version reads as a date: shown short (2026.11.07), with the full build number under it.
	const short = shortVersion(version);
	const built = short !== version ? formatWhen(Number(version)) : undefined;
</script>

<svelte:head>
	<title>About · Trolay</title>
</svelte:head>

{#snippet versionValue()}
	{short}
	{#if short !== version}<span class="build">{version}</span>{/if}
{/snippet}

<div class="page">
	<AppHeader title="About Trolay" back={{ href: resolve('/settings'), label: 'Settings' }} />

	<SettingsGroup title="This version">
		<SettingsRow label="Version" value={versionValue} />
		{#if built}<SettingsRow label="Built" value={built} />{/if}
		<SettingsRow label="What's new" href={resolve('/settings/about/changelog')} />
	</SettingsGroup>

	<SettingsGroup
		title="Help"
		note="Your stores, trips and items are kept on this phone. When you're signed in, they also sync between your own devices."
	>
		<SettingsRow label="Getting started guide" href={resolve('/welcome')} />
	</SettingsGroup>
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.build {
		display: block;
		font-size: 0.78rem;
		font-variant-numeric: tabular-nums;
	}
</style>
