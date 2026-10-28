<script lang="ts">
	import '../app.css';
	import { requestPersistentStorage } from '#lib/data/db.ts';
	import InstallNudge from '#lib/components/InstallNudge.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	$effect(() => {
		requestPersistentStorage().catch((error: unknown) =>
			console.warn('Persistent storage:', error)
		);
	});
</script>

<InstallNudge />
{@render children()}
