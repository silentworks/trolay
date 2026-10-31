<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import SyncStatus from '#lib/components/SyncStatus.svelte';
	import { account } from '#lib/auth/account.svelte.ts';
	import { pendingInvite } from '#lib/sharing/invites.ts';

	let email = $state('');

	onMount(() => void account.refresh());
</script>

{#snippet emailForm(heading: string, button: string)}
	<form
		class="email"
		onsubmit={(event) => {
			event.preventDefault();
			void account.requestLink(email);
		}}
	>
		<label for="account-email">{heading}</label>
		<input
			id="account-email"
			class="input"
			type="email"
			autocomplete="email"
			required
			bind:value={email}
		/>
		<button class="btn" type="submit" disabled={account.busy}>{button}</button>
		{#if account.linkSentTo}
			<p class="status" role="status">
				Check your email. The link works once and expires in 15 minutes.
			</p>
		{/if}
	</form>
{/snippet}

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
		</div>
		{@render emailForm(
			'Add an email address, so you can sign in without a passkey',
			'Email me a link to confirm it'
		)}
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
		{@render emailForm('No passkey on this device? Sign in by email', 'Email me a sign-in link')}
	{/if}

	{#if account.error}<p class="error" role="alert">{account.error}</p>{/if}
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

	.email {
		display: grid;
		gap: 8px;
		margin-top: 28px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	.email label {
		font-weight: 600;
	}

	.actions {
		display: grid;
		gap: 8px;
		margin-top: 16px;
	}
</style>
