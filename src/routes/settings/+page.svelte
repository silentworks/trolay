<script lang="ts">
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { settings } from '#lib/settings.svelte.ts';
	import type { Theme } from '#lib/theme.ts';

	const looks: { value: Theme; label: string; hint?: string }[] = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'system', label: 'Match my phone', hint: "Light or dark as your phone's setting is." }
	];
</script>

<svelte:head>
	<title>Settings · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="Settings" back={{ href: resolve('/'), label: 'Trolley' }} />

	<fieldset class="choice">
		<legend>Appearance</legend>
		{#each looks as look (look.value)}
			<label class="check">
				<input
					type="radio"
					name="theme"
					value={look.value}
					checked={settings.theme === look.value}
					onchange={() => settings.setTheme(look.value)}
				/>
				<span>
					{look.label}
					{#if look.hint}<span class="hint">{look.hint}</span>{/if}
				</span>
			</label>
		{/each}
	</fieldset>
	<p class="note">Kept on this phone.</p>
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.choice {
		display: grid;
		gap: 4px;
		margin: 0;
		padding: 12px 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	legend {
		padding: 0 4px;
		font-weight: 700;
	}

	.check > span {
		display: grid;
	}

	.hint,
	.note {
		color: var(--muted);
		font-size: 0.88rem;
		font-weight: 400;
	}
</style>
