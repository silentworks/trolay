<script lang="ts">
	import { resolve } from '$app/paths';
	import { account } from '#lib/auth/account.svelte.ts';
	import AppHeader from '#lib/components/AppHeader.svelte';
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

	{#each groups as group, i (group.title)}
		<section aria-labelledby="group-{i}">
			<h2 id="group-{i}" class="group">{group.title}</h2>
			<ul class="card">
				{#each group.rows as row (row.label)}
					<li>
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the rows hold resolve()d paths -->
						<a class="row" href={row.href}>
							<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
								{#each row.icon as d (d)}<path {d} />{/each}
							</svg>
							<span class="label">{row.label}</span>
							{#if row.value}<span class="value">{row.value}</span>{/if}
							<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true">
								<path d="m9.5 6 6 6-6 6" />
							</svg>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.group {
		margin: calc(20px * var(--density)) 4px calc(6px * var(--density));
		color: var(--muted);
		font-size: 0.85rem;
		font-weight: 600;
	}

	.card {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		overflow: hidden;
	}

	/* A hairline between rows, starting after the icon as on iOS. */
	li + li .row::before {
		content: '';
		position: absolute;
		top: 0;
		left: 52px;
		right: 0;
		border-top: 1px solid var(--border);
	}

	.row {
		position: relative;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: var(--tap);
		padding: calc(10px * var(--density)) 10px calc(10px * var(--density)) 16px;
		color: var(--text);
		text-decoration: none;
	}

	.row:hover {
		background: var(--surface-2);
	}

	/* On a narrow phone the value gives way, so the label stays on one line. */
	.label {
		flex: 1 0 auto;
		max-width: 100%;
		font-weight: 600;
	}

	.value {
		flex: 0 1 auto;
		min-width: 0;
		font-size: 0.92rem;
		color: var(--muted);
		text-align: right;
	}

	svg {
		flex: none;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.icon {
		width: 24px;
		height: 24px;
	}

	.chevron {
		width: 18px;
		height: 18px;
		color: var(--muted);
	}
</style>
