<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import SyncStatus from '#lib/components/SyncStatus.svelte';
	import { account } from '#lib/auth/account.svelte.ts';
	import { pendingInvite } from '#lib/sharing/invites.ts';

	onMount(() => void account.refresh());
</script>

<svelte:head><title>Account · Trolay</title></svelte:head>

<div class="page">
	<AppHeader title="Account" back={{ href: resolve('/'), label: 'Trolley' }} />

	{#if account.status === 'signedIn'}
		<p class="status" role="status">You're signed in on this device.</p>
		{#if pendingInvite()}
			<a class="btn btn-primary btn-block" href={resolve('/join')}>Continue joining the trip</a>
		{/if}
		<SyncStatus />
		<p class="hint">Sign in with a passkey on another device to use the same account there.</p>
		<div class="actions">
			<button class="btn" type="button" disabled={account.busy} onclick={() => account.register()}>
				Add a passkey on this device
			</button>
			<button class="btn" type="button" disabled={account.busy} onclick={() => account.signOut()}>
				Sign out
			</button>
			<button
				class="btn btn-ghost"
				type="button"
				disabled={account.busy}
				onclick={() => account.signOutEverywhere()}
			>
				Sign out on all devices
			</button>
		</div>
		<p class="hint">
			Lost a phone? Signing out on all devices ends every session, this one too. What's on each
			phone stays there.
		</p>
	{:else if account.status === 'unknown' && account.maybeSignedIn}
		<p class="hint">
			You were signed in here, and there is no signal to check right now. Everything you do is kept
			on this phone and will sync when you're back online.
		</p>
		<SyncStatus />
	{:else}
		<p class="hint">
			Your stores, trips and items live on this phone, and you don't need an account to use Trolay.
			An account will let them sync between your own devices. It uses a passkey, so there is no
			password to remember.
		</p>
		<div class="actions">
			<button
				class="btn btn-primary"
				type="button"
				disabled={account.busy}
				onclick={() => account.signIn()}
			>
				Sign in with a passkey
			</button>
			<button class="btn" type="button" disabled={account.busy} onclick={() => account.register()}>
				Create an account with a passkey
			</button>
		</div>
	{/if}

	{#if account.error}<p class="error" role="alert">{account.error}</p>{/if}

	<a class="btn btn-ghost btn-block guide" href={resolve('/welcome')}
		>Show the getting started guide</a
	>
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.hint {
		color: var(--muted);
	}

	.status {
		font-weight: 700;
		color: var(--accent);
	}

	.guide {
		margin-top: 28px;
	}

	.actions {
		display: grid;
		gap: 8px;
		margin-top: 16px;
	}
</style>
