<script lang="ts">
	import { account } from '#lib/auth/account.svelte.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';
	import SettingsSection from './SettingsSection.svelte';

	// "Keep price tag photos in the cloud": off until the shopper turns it on, and only signed in.
	// Turning it on uploads straight away; turning it off only stops new uploads.
	const signedIn = $derived(account.status === 'signedIn');
	const on = $derived(settings.keepPhotos);

	function toggle() {
		const next = !on;
		settings.setKeepPhotos(next);
		if (next) void syncEngine.syncNow();
	}
</script>

<SettingsSection
	title="Keep price tag photos in the cloud"
	lead="Copies of your price tag photos are kept in Trolay's cloud storage. You can see and download them from History. They stay there until you delete your account."
>
	{#snippet control(ids)}
		<button
			class="switch"
			type="button"
			role="switch"
			aria-checked={on}
			aria-labelledby={ids.title}
			aria-describedby="{ids.lead} keep-photos-note"
			disabled={!signedIn && !on}
			onclick={toggle}
		>
			<span class="knob"></span>
		</button>
	{/snippet}
	<p class="hint" id="keep-photos-note">
		{#if !signedIn && !on}
			Sign in to keep your photos in the cloud.
		{:else if on}
			Turning this off stops new photos from being kept. Photos already kept stay in the cloud until
			you delete your account.
		{:else}
			Turning this on keeps the photos still on this phone straight away, and every new one after.
		{/if}
	</p>
</SettingsSection>

<style>
	.hint {
		margin: 0;
		color: var(--muted);
		font-size: 0.88rem;
	}

	.switch:disabled {
		opacity: 0.5;
	}
</style>
