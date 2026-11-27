<script lang="ts">
	import { account } from '#lib/auth/account.svelte.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
	import SettingsGroup from './SettingsGroup.svelte';
	import SettingsRow from './SettingsRow.svelte';

	// "Keep price tag photos in the cloud": off until the shopper turns it on, and only signed in.
	// Turning it on uploads straight away; turning it off only stops new uploads.
	const signedIn = $derived(account.status === 'signedIn');
	const on = $derived(settings.keepPhotos);

	function toggle() {
		const next = !on;
		settings.setKeepPhotos(next);
		if (next) void syncEngine.syncNow();
	}

	const CLOUD = ['M7 18a4 4 0 0 1-.5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 18Z'];
</script>

{#snippet note()}
	<p>
		Copies of your price tag photos are kept in Trolay's cloud storage. You can see and download
		them from History. They stay there until you delete your account.
	</p>
	<p>
		{#if !signedIn && !on}
			Sign in to keep your photos in the cloud.
		{:else if on}
			Turning this off stops new photos from being kept. Photos already kept stay in the cloud until
			you delete your account.
		{:else}
			Turning this on keeps the photos still on this phone straight away, and every new one after.
		{/if}
	</p>
{/snippet}

<SettingsGroup title="Photos" {note}>
	{#snippet children(ids)}
		<SettingsRow
			label="Keep price tag photos in the cloud"
			icon={CLOUD}
			checked={on}
			disabled={!signedIn && !on}
			describedby={ids.note}
			onclick={toggle}
		/>
	{/snippet}
</SettingsGroup>
