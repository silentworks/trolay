<script lang="ts">
	import '../app.css';
	import { requestPersistentStorage } from '#lib/data/db.ts';
	import { processPendingLookups } from '#lib/data/products.ts';
	import InstallNudge from '#lib/components/InstallNudge.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	$effect(() => {
		requestPersistentStorage().catch((error: unknown) =>
			console.warn('Persistent storage:', error)
		);
	});

	// Names barcodes that were scanned with no signal, now and whenever the signal returns.
	$effect(() => {
		const retry = () => processPendingLookups().catch((error) => console.warn(error));
		retry();
		window.addEventListener('online', retry);
		return () => window.removeEventListener('online', retry);
	});
</script>

<InstallNudge />
{@render children()}
