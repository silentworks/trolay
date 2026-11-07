<script lang="ts">
	import { resolve } from '$app/paths';
	import { ACCENTS, DENSITIES, TEXT_SIZES } from '#lib/appearance.ts';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import SettingsSection from '#lib/components/SettingsSection.svelte';
	import { settings } from '#lib/settings.svelte.ts';
	import type { Theme } from '#lib/theme.ts';

	const uid = $props.id();

	const looks: { value: Theme; label: string; hint?: string }[] = [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'system', label: 'System', hint: "Light or dark as your phone's setting is." }
	];
</script>

<svelte:head>
	<title>Appearance · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="Appearance" back={{ href: resolve('/settings'), label: 'Settings' }} />

	<SettingsSection title="Theme" lead="Choose how Trolay looks and feels.">
		{#snippet children(ids)}
			<div class="looks" role="radiogroup" aria-labelledby={ids.title} aria-describedby={ids.lead}>
				{#each looks as look (look.value)}
					<label class="look">
						<input
							class="pick"
							type="radio"
							name="theme"
							value={look.value}
							checked={settings.theme === look.value}
							onchange={() => settings.setTheme(look.value)}
							aria-describedby={look.hint ? `${uid}-${look.value}-hint` : undefined}
						/>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							{#if look.value === 'light'}
								<circle cx="12" cy="12" r="4" />
								<path
									d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"
								/>
							{:else if look.value === 'dark'}
								<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
							{:else}
								<rect x="3" y="4" width="18" height="12.5" rx="2" />
								<path d="M8.5 20.5h7M12 16.5v4" />
							{/if}
						</svg>
						<span>{look.label}</span>
					</label>
				{/each}
			</div>
			<!-- Read out with the System card, outside its label so it isn't part of its name. -->
			{#each looks as look (look.value)}
				{#if look.hint}
					<span class="visually-hidden" id="{uid}-{look.value}-hint">{look.hint}</span>
				{/if}
			{/each}
		{/snippet}
	</SettingsSection>

	<SettingsSection title="Accent colour" lead="Choose a colour that matches your style.">
		{#snippet children(ids)}
			<div
				class="swatches"
				role="radiogroup"
				aria-labelledby={ids.title}
				aria-describedby={ids.lead}
			>
				{#each ACCENTS as accent (accent.value)}
					<label class="swatch" style:--light={accent.light} style:--dark={accent.dark}>
						<input
							class="pick"
							type="radio"
							name="accent"
							value={accent.value}
							checked={settings.accent === accent.value}
							onchange={() => settings.setAccent(accent.value)}
						/>
						<span class="visually-hidden">{accent.label}</span>
					</label>
				{/each}
			</div>
		{/snippet}
	</SettingsSection>
	<SettingsSection title="Text size" lead="Adjust the size of text across the app.">
		{#snippet children(ids)}
			<div class="size">
				<span class="small" aria-hidden="true">A</span>
				<input
					type="range"
					min="0"
					max={TEXT_SIZES.length - 1}
					step="1"
					value={TEXT_SIZES.indexOf(settings.textSize)}
					oninput={(event) => settings.setTextSize(TEXT_SIZES[event.currentTarget.valueAsNumber])}
					aria-labelledby={ids.title}
					aria-describedby={ids.lead}
					aria-valuetext="{settings.textSize}%"
				/>
				<span class="large" aria-hidden="true">A</span>
			</div>
			<!-- How an item in the trolley reads at this size. -->
			<div class="sample" aria-hidden="true">
				<span class="sample-name">Semi-skimmed milk</span>
				<span class="sample-price">1.45</span>
				<span class="sample-meta">1.45 each · incl. tax</span>
			</div>
		{/snippet}
	</SettingsSection>
	<SettingsSection
		title="Interface density"
		lead="Control spacing for a more compact or spacious view."
	>
		{#snippet children(ids)}
			<div class="looks" role="radiogroup" aria-labelledby={ids.title} aria-describedby={ids.lead}>
				{#each DENSITIES as density, i (density.value)}
					<label class="look">
						<input
							class="pick"
							type="radio"
							name="density"
							value={density.value}
							checked={settings.density === density.value}
							onchange={() => settings.setDensity(density.value)}
						/>
						<!-- Three lines, closer together or further apart. -->
						<svg viewBox="0 0 24 24" aria-hidden="true">
							{#each [-1, 0, 1] as line (line)}
								<path d="M5 {12 + line * (i + 2) * 1.6}h14" />
							{/each}
						</svg>
						<span>{density.label}</span>
					</label>
				{/each}
			</div>
		{/snippet}
	</SettingsSection>
	<p class="note">Kept on this phone.</p>
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.note {
		margin: 8px 4px 0;
		color: var(--muted);
		font-size: 0.88rem;
	}

	/* Three cards of the same width, each an icon over its label. */
	.looks {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}

	.look {
		position: relative;
		display: grid;
		justify-items: center;
		gap: 8px;
		padding: 16px 4px 12px;
		border-radius: 12px;
		background: var(--surface-2);
		color: var(--muted);
		font-size: 0.94rem;
		font-weight: 600;
		cursor: pointer;
	}

	/* Too narrow for three side by side (a small phone, or large text): one under another, each
	   with its icon beside its label. In em, so it follows the text size. */
	@container (width < 19em) {
		.looks {
			grid-template-columns: minmax(0, 1fr);
			gap: 8px;
		}

		.look {
			grid-auto-flow: column;
			justify-content: start;
			align-items: center;
			gap: 12px;
			padding: var(--space-3) 16px;
		}
	}

	/* The radio is invisible and covers the card, so a tap anywhere on it picks it. */
	.pick {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.look:has(:checked) {
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	/* The radio is hidden, so its focus ring shows on the card. */
	.look:has(:focus-visible),
	.swatch:has(:focus-visible) {
		outline: 3px solid var(--focus);
		outline-offset: 2px;
	}

	/* Round swatches, each its colour as it looks in this theme; the chosen one has a ring. */
	/* One row: six columns, at least 44px each down to a 360px-wide phone. */
	.swatches {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		gap: 6px;
		padding: 6px 0;
	}

	.swatch {
		position: relative;
		justify-self: center;
		width: 100%;
		max-width: var(--tap);
		aspect-ratio: 1;
		border-radius: 50%;
		background: var(--light);
	}

	:global([data-theme='dark']) .swatch {
		background: var(--dark);
	}

	.swatch:has(:checked) {
		box-shadow:
			0 0 0 3px var(--surface),
			0 0 0 6px var(--text);
	}

	.swatch:has(:focus-visible) {
		outline-offset: 8px;
	}

	.swatch .pick {
		border-radius: 50%;
	}

	.size {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 12px;
		min-height: var(--tap);
	}

	.size input {
		width: 100%;
		margin: 0;
		accent-color: var(--accent);
	}

	.small,
	.large {
		font-weight: 700;
		color: var(--muted);
		line-height: 1;
	}

	/* Fixed, unlike everything else, so the ends of the slider stay the same. */
	.small {
		font-size: 13px;
	}

	.large {
		font-size: 24px;
	}

	.sample {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		column-gap: 12px;
		margin-top: 12px;
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--surface-2);
	}

	.sample-name {
		font-weight: 700;
	}

	.sample-price {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.sample-meta {
		grid-column: 1 / -1;
		color: var(--muted);
		font-size: 0.85rem;
	}

	svg {
		width: 28px;
		height: 28px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
