<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import DeleteAccount from '#lib/components/DeleteAccount.svelte';
	import KeepPhotosSetting from '#lib/components/KeepPhotosSetting.svelte';
	import SettingsGroup from '#lib/components/SettingsGroup.svelte';
	import SettingsRow from '#lib/components/SettingsRow.svelte';
	import SyncStatus from '#lib/components/SyncStatus.svelte';
	import { account } from '#lib/auth/account.svelte.ts';
	import { pendingInvite } from '#lib/sharing/invites.ts';

	onMount(() => void account.refresh());

	const PERSON = ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4.5 20a7.5 7.5 0 0 1 15 0'];
	const PLUS = ['M12 5v14', 'M5 12h14'];
	const KEY = ['M14.5 9.5a4 4 0 1 0-3.9 4.9L8 17v3h3v-2h2v-2l1.6-1.6', 'M16.5 7.5h.01'];
	const SIGN_OUT = ['M14 4h5v16h-5', 'M10 8l-4 4 4 4', 'M6 12h10'];
	const EVERYWHERE = ['M4 8h11v12H4Z', 'M9 4h11v12'];
	const TROLLEY = ['M3 4h2l2.4 11h11L21 7H6.2', 'M9 20h.01', 'M17 20h.01'];
</script>

<svelte:head><title>Account & sync · Trolay</title></svelte:head>

{#snippet syncStatus()}<SyncStatus />{/snippet}

<div class="page">
	<AppHeader title="Account & sync" back={{ href: resolve('/settings'), label: 'Settings' }} />

	{#if account.status === 'signedIn'}
		<SettingsGroup
			title="Account"
			note="Sign in with a passkey on another device to use the same account there. Lost a phone? Signing out on all devices ends every session, this one too. What's on each phone stays there."
		>
			<SettingsRow label="You're signed in on this device." icon={PERSON} sub={syncStatus} />
			{#if pendingInvite()}
				<SettingsRow label="Continue joining the trip" icon={TROLLEY} href={resolve('/join')} />
			{/if}
			<SettingsRow
				label="Add a passkey on this device"
				icon={PLUS}
				disabled={account.busy}
				onclick={() => account.register()}
			/>
			<SettingsRow
				label="Sign out"
				icon={SIGN_OUT}
				disabled={account.busy}
				onclick={() => account.signOut()}
			/>
			<SettingsRow
				label="Sign out on all devices"
				icon={EVERYWHERE}
				disabled={account.busy}
				onclick={() => account.signOutEverywhere()}
			/>
		</SettingsGroup>
	{:else if account.status === 'unknown' && account.maybeSignedIn}
		<SettingsGroup
			title="Account"
			note="There is no signal to check your account right now. Everything you do is kept on this phone and will sync when you're back online."
		>
			<SettingsRow label="You were signed in here." icon={PERSON} sub={syncStatus} />
		</SettingsGroup>
	{:else}
		<SettingsGroup
			title="Account"
			note="Your stores, trips and items live on this phone, and you don't need an account to use Trolay. An account will let them sync between your own devices. It uses a passkey, so there is no password to remember."
		>
			<SettingsRow
				label="Sign in with a passkey"
				icon={KEY}
				disabled={account.busy}
				onclick={() => account.signIn()}
			/>
			<SettingsRow
				label="Create an account with a passkey"
				icon={PLUS}
				disabled={account.busy}
				onclick={() => account.register()}
			/>
		</SettingsGroup>
	{/if}

	{#if account.error}<p class="error" role="alert">{account.error}</p>{/if}

	<KeepPhotosSetting />

	{#if account.status === 'signedIn'}<DeleteAccount />{/if}
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.error {
		margin: 12px 0 0;
	}
</style>
