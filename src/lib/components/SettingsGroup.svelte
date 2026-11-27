<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Ids {
		title: string;
		note: string;
	}

	interface Props {
		/** The muted title over the card; it names the group. */
		title?: string;
		/** Under the card: what the group does. */
		note?: string | Snippet;
		/** Something other than rows in the card (a picker, a slider, a form), with room round it. */
		padded?: boolean;
		/** SettingsRows, or with `padded` anything; given the ids of the title and the note. */
		children: Snippet<[Ids]>;
	}

	let { title, note, padded = false, children }: Props = $props();
	const uid = $props.id();
	const ids: Ids = { title: `${uid}-title`, note: `${uid}-note` };
</script>

<!-- One group of settings, as on the main Settings page: a title, a card, a note. -->
<section class="settings-group" aria-labelledby={title ? ids.title : undefined}>
	{#if title}<h2 class="settings-title" id={ids.title}>{title}</h2>{/if}
	{#if padded}
		<div class="settings-card padded">{@render children(ids)}</div>
	{:else}
		<ul class="settings-card">{@render children(ids)}</ul>
	{/if}
	{#if note}
		<div class="settings-note" id={ids.note}>
			{#if typeof note === 'string'}{note}{:else}{@render note()}{/if}
		</div>
	{/if}
</section>
