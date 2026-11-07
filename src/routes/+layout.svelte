<script lang="ts">
	import '../app.css';
	import { account } from '#lib/auth/account.svelte.ts';
	import { requestPersistentStorage } from '#lib/data/db.ts';
	import { getOpenTrip } from '#lib/data/trips.ts';
	import { LiveQuery } from '#lib/live.svelte.ts';
	import { processPendingLookups } from '#lib/data/products.ts';
	import { purgeDeletedPhotos } from '#lib/data/trips.ts';
	import InstallNudge from '#lib/components/InstallNudge.svelte';
	import PartnerAdded from '#lib/components/PartnerAdded.svelte';
	import ToastHost from '#lib/components/ToastHost.svelte';
	import WhatsNew from '#lib/components/WhatsNew.svelte';
	import UpdatePrompt from '#lib/components/UpdatePrompt.svelte';
	import { settings } from '#lib/settings.svelte.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
	import { applyAccent, applyAnimations, applyDensity, applyTextSize } from '#lib/appearance.ts';
	import { applyTheme } from '#lib/theme.ts';
	import { LiveTrip } from '#lib/sync/live.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Safari on iPhone ignores the viewport's zoom lock; its own gesture events are the way to stop
	// a pinch there.
	$effect(() => {
		const stop = (event: Event) => event.preventDefault();
		document.addEventListener('gesturestart', stop);
		document.addEventListener('gesturechange', stop);
		return () => {
			document.removeEventListener('gesturestart', stop);
			document.removeEventListener('gesturechange', stop);
		};
	});

	// The look chosen in Settings; "match my phone" follows the phone as it switches.
	$effect(() => applyTheme(settings.theme));
	$effect(() => applyAccent(settings.accent));
	$effect(() => applyTextSize(settings.textSize));
	$effect(() => applyDensity(settings.density));
	$effect(() => applyAnimations(settings.animations));

	// The photos of trips deleted when the app last closed, too soon to have gone already.
	$effect(() => {
		purgeDeletedPhotos().catch((error: unknown) => console.warn('Purging photos:', error));
	});

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

	// Syncing is optional: it runs only on a phone that has signed in. Who is signed in is asked
	// at the start, and again when the signal returns if there was none to ask. The browser's
	// "online" event is not always sent, so it is also tried now and then.
	$effect(() => {
		void account.restore();
		const again = () => account.status === 'unknown' && void account.restore();
		window.addEventListener('online', again);
		const timer = setInterval(again, 15_000);
		return () => {
			window.removeEventListener('online', again);
			clearInterval(timer);
		};
	});

	$effect(() => syncEngine.watch());

	// While signed in with a trip open, listen for changes made to it on the other phone, so they
	// arrive in a moment rather than at the next round.
	const openTrip = new LiveQuery(() => getOpenTrip());
	const live = new LiveTrip({
		sync: () => void syncEngine.syncNow(),
		url: (tripId) =>
			`${location.origin.replace(/^http/, 'ws')}/api/trips/live?trip=${encodeURIComponent(tripId)}`
	});
	$effect(() => {
		const trip = openTrip.current;
		if (account.status === 'signedIn' && trip) return live.connect(trip.id);
	});

	$effect(() => {
		if (account.status === 'signedIn') return syncEngine.start();
	});
</script>

{@render children()}
<InstallNudge />
<PartnerAdded />
<UpdatePrompt />
<WhatsNew />
<ToastHost />
