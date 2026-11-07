<script lang="ts">
	import type { ChangelogEntry } from '#lib/changelog.ts';
	import ChangelogEntries from './ChangelogEntries.svelte';
	import Sheet from './Sheet.svelte';

	interface Props {
		open: boolean;
		entries: ChangelogEntry[];
		onclose: () => void;
	}

	let { open, entries, onclose }: Props = $props();
</script>

<Sheet {open} title="What's new" {onclose}>
	<div class="entries">
		<ChangelogEntries {entries} level={3} />
	</div>
	<button class="btn btn-primary btn-block" type="button" onclick={onclose}>Got it</button>
</Sheet>

<style>
	.entries {
		margin-bottom: 20px;
	}
</style>
