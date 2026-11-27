<script lang="ts">
	import { resolve } from '$app/paths';
	import { account } from '#lib/auth/account.svelte.ts';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import SettingsGroup from '#lib/components/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/SettingsRow.svelte';
	import { settings } from '#lib/settings.svelte.ts';
	import type { Theme } from '#lib/theme.ts';

	interface Row {
		label: string;
		href: string;
		/** Line icon paths, drawn in a 24×24 box. */
		icon: string[];
		value?: string;
	}

	const LOOKS: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' };

	const signedIn = $derived(
		account.status === 'signedIn'
			? 'Signed in'
			: account.status === 'unknown' && account.maybeSignedIn
				? 'Offline'
				: 'Not signed in'
	);

	const groups = $derived<{ title: string; rows: Row[] }[]>([
		{
			title: 'Your account',
			rows: [
				{
					label: 'Account & sync',
					href: resolve('/settings/account'),
					icon: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 20a7.5 7.5 0 0 1 15 0'],
					value: signedIn
				}
			]
		},
		{
			title: 'App',
			rows: [
				{
					label: 'Appearance',
					href: resolve('/settings/appearance'),
					icon: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 3v18a9 9 0 0 0 0-18Z'],
					value: LOOKS[settings.theme]
				},
				{
					label: 'Backup & restore',
					href: resolve('/settings/backup'),
					icon: ['M4 7h16v13H4Z', 'M3 3h18v4H3Z', 'M10 11h4']
				},
				{
					label: 'Stores',
					href: resolve('/stores'),
					icon: [
						'M4 9 5.5 4h13L20 9',
						'M4 9h16v2a3 3 0 0 1-6 0 2 2 0 0 1-4 0 3 3 0 0 1-6 0Z',
						'M5 13v7h14v-7',
						'M10 20v-4h4v4'
					]
				}
			]
		},
		{
			title: 'Help',
			rows: [
				{
					label: 'Getting started guide',
					href: resolve('/welcome'),
					icon: ['M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2Z', 'M4 19V5', 'M18 19v2H6']
				},
				{
					label: 'Send feedback',
					href: resolve('/settings/feedback'),
					icon: ['M4 5h16v11H10l-4.5 4v-4H4Z', 'M8 9.5h8', 'M8 12.5h5']
				},
				{
					label: 'About Trolay',
					href: resolve('/settings/about'),
					icon: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z', 'M12 11v5', 'M12 8h.01']
				}
			]
		}
	]);
</script>

<svelte:head>
	<title>Settings · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="Settings" back={{ href: resolve('/'), label: 'Trolley' }} />

	{#each groups as group (group.title)}
		<SettingsGroup title={group.title}>
			{#each group.rows as row (row.label)}
				<SettingsRow label={row.label} href={row.href} icon={row.icon} value={row.value} />
			{/each}
		</SettingsGroup>
	{/each}
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}
</style>
