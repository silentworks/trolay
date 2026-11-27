<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		label: string;
		/** Line icon paths, drawn in a 24×24 box. */
		icon?: string[];
		/** What it's set to, at the end of the row. */
		value?: string | Snippet;
		/** A line under the label. */
		sub?: string | Snippet;
		/** The id of that line, for describing something else by it. */
		subId?: string;
		/** A link to another page, with a chevron. */
		href?: string;
		/** A switch, on or off: `onclick` turns it. A tap anywhere on the row does too. */
		checked?: boolean;
		/** A button (or, with `checked`, a switch). */
		onclick?: () => void;
		/** A button's colour: the accent, or red for one that deletes. */
		tone?: 'action' | 'danger';
		disabled?: boolean;
		/** More to describe a switch by, besides the line under the label. */
		describedby?: string;
		/** A field at the end of the row (`children`), labelled by the row's label. */
		labelFor?: string;
		children?: Snippet;
	}

	let {
		label,
		icon,
		value,
		sub,
		subId: givenSubId,
		href,
		checked,
		onclick,
		tone = 'action',
		disabled = false,
		describedby,
		labelFor,
		children
	}: Props = $props();

	const uid = $props.id();
	const labelId = `${uid}-label`;
	const subId = $derived(givenSubId ?? `${uid}-sub`);
	const described = $derived(
		[sub ? subId : undefined, describedby].filter(Boolean).join(' ') || undefined
	);
</script>

{#snippet text()}
	{#if icon}
		<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
			{#each icon as d (d)}<path {d} />{/each}
		</svg>
	{/if}
	<span class="text">
		{#if labelFor}
			<label class="label" id={labelId} for={labelFor}>{label}</label>
		{:else}
			<span class="label" id={labelId}>{label}</span>
		{/if}
		{#if sub}
			<span class="sub" id={subId}>
				{#if typeof sub === 'string'}{sub}{:else}{@render sub()}{/if}
			</span>
		{/if}
	</span>
	{#if value}
		<span class="value">
			{#if typeof value === 'string'}{value}{:else}{@render value()}{/if}
		</span>
	{/if}
{/snippet}

<li>
	{#if href}
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- given resolve()d paths -->
		<a class="settings-row" class:with-icon={!!icon} {href}>
			{@render text()}
			<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6" /></svg>
		</a>
	{:else if checked !== undefined}
		<!-- The whole row is the switch's label, so a tap anywhere on it turns the switch. -->
		<label class="settings-row" class:with-icon={!!icon}>
			{@render text()}
			<button
				class="switch"
				type="button"
				role="switch"
				aria-checked={checked}
				aria-labelledby={labelId}
				aria-describedby={described}
				{disabled}
				{onclick}
			>
				<span class="knob"></span>
			</button>
		</label>
	{:else if onclick}
		<button class="settings-row {tone}" class:with-icon={!!icon} type="button" {disabled} {onclick}>
			{@render text()}
		</button>
	{:else}
		<div class="settings-row" class:with-icon={!!icon}>
			{@render text()}
			{@render children?.()}
		</div>
	{/if}
</li>
