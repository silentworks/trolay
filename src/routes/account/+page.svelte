<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import SyncStatus from '#lib/components/SyncStatus.svelte';
	import { account, type CodeResult } from '#lib/auth/account.svelte.ts';
	import { pendingInvite } from '#lib/sharing/invites.ts';

	let email = $state('');
	let code = $state('');
	let result = $state<CodeResult>();

	const digits = $derived(code.replace(/\D/g, ''));

	onMount(() => void account.refresh());

	async function submitCode() {
		result = await account.verifyCode(digits);
		if (result) code = '';
	}
</script>

{#snippet emailForm(heading: string, button: string, confirm: string)}
	{#if account.codeSentTo}
		<form
			class="email"
			onsubmit={(event) => {
				event.preventDefault();
				void submitCode();
			}}
		>
			<p class="status" role="status">
				Check your email. The code works once and expires in 10 minutes.
			</p>
			<label for="account-code">Enter the 6-digit code sent to {account.codeSentTo}</label>
			<input
				id="account-code"
				class="input code"
				inputmode="numeric"
				autocomplete="one-time-code"
				maxlength="7"
				placeholder="123 456"
				bind:value={code}
			/>
			<button class="btn btn-primary" type="submit" disabled={account.busy || digits.length !== 6}>
				{confirm}
			</button>
			<button
				class="btn btn-ghost"
				type="button"
				onclick={() => {
					code = '';
					account.startOver();
				}}
			>
				Use a different email
			</button>
		</form>
	{:else}
		<form
			class="email"
			onsubmit={(event) => {
				event.preventDefault();
				result = undefined;
				void account.requestCode(email);
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
		</form>
	{/if}
{/snippet}

<svelte:head><title>Account · Trolay</title></svelte:head>

<div class="page">
	<AppHeader title="Account" back={{ href: resolve('/'), label: 'Trolley' }} />

	{#if account.status === 'signedIn'}
		<p class="status" role="status">You're signed in on this device.</p>
		{#if result?.kind === 'signedIn' && !result.hasPasskey}
			<p class="hint">
				Add a passkey on this device, and you can sign in here without waiting for an email.
			</p>
		{:else if result?.kind === 'added'}
			<p class="status">{result.email} is now on your account.</p>
		{/if}
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
			'Email me a code to confirm it',
			'Confirm email'
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
		{@render emailForm(
			'No passkey on this device? Sign in by email',
			'Email me a sign-in code',
			'Sign in'
		)}
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

	.code {
		font-size: 1.4rem;
		letter-spacing: 0.2em;
		text-align: center;
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
