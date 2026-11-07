<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		lead: string;
		/** Given the ids of the title and the lead, for naming and describing what's inside. */
		children: Snippet<[{ title: string; lead: string }]>;
	}

	let { title, lead, children }: Props = $props();
	const uid = $props.id();
	const ids = { title: `${uid}-title`, lead: `${uid}-lead` };
</script>

<!-- A titled card of settings, with a line under the title saying what they do. -->
<section class="section" aria-labelledby={ids.title}>
	<h2 id={ids.title}>{title}</h2>
	<p class="lead" id={ids.lead}>{lead}</p>
	{@render children(ids)}
</section>

<style>
	.section {
		padding: 16px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	.section + :global(.section) {
		margin-top: 12px;
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
	}

	.lead {
		margin: 2px 0 14px;
		color: var(--muted);
		font-size: 0.88rem;
	}
</style>
