<script lang="ts">
	import { CHANGELOG, unseen } from '#lib/changelog.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import WhatsNewSheet from './WhatsNewSheet.svelte';

	// Once per release with an entry: what changed since this phone last looked. Shown as the app
	// opens, and marked seen there and then, so a reload doesn't show it again.
	const entries = unseen(settings.whatsNewSeen, settings.onboarded);
	let open = $state(entries.length > 0);
	if (CHANGELOG.length) settings.markWhatsNewSeen(CHANGELOG[0].version);
</script>

<WhatsNewSheet {open} {entries} onclose={() => (open = false)} />
