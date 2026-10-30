<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { account, type LinkResult } from '#lib/auth/account.svelte.ts';

	let result = $state<LinkResult>();
	let finished = $state(false);
	let passkeyAdded = $state(false);

	onMount(async () => {
		// The token is in the address's fragment, so it never reached the server in the request for
		// this page. Take it out of the address bar before anything else.
		const token = new URLSearchParams(location.hash.slice(1)).get('token');
		history.replaceState(history.state, '', location.pathname);
		if (token) result = await account.completeLink(token);
		else account.error = 'That link is missing its code. Ask for a new one.';
		finished = true;
	});

	async function addPasskey() {
		await account.register();
		passkeyAdded = !account.error;
	}
</script>

<svelte:head><title>Sign in · Trolay</title></svelte:head>

<div class="page">
	<AppHeader title="Sign in" back={{ href: resolve('/account'), label: 'Account' }} />

	{#if !finished}
		<p class="hint" role="status">Signing you in…</p>
	{:else if result?.kind === 'signedIn'}
		<p class="status" role="status">You're signed in on this device.</p>
		{#if passkeyAdded}
			<p class="hint">Passkey added. Next time, sign in with it.</p>
		{:else if !result.hasPasskey}
			<p class="hint">
				Add a passkey on this device, and you can sign in here without waiting for an email.
			</p>
			<div class="actions">
				<button class="btn btn-primary" type="button" disabled={account.busy} onclick={addPasskey}>
					Add a passkey on this device
				</button>
			</div>
		{/if}
		<a class="btn btn-block next" href={resolve('/')}>
			{result.hasPasskey || passkeyAdded ? 'Continue' : 'Not now'}
		</a>
	{:else if result?.kind === 'added'}
		<p class="status" role="status">{result.email} is now on your account.</p>
		<p class="hint">You can use it to sign in if a passkey isn't available.</p>
		<a class="btn btn-block next" href={resolve('/account')}>Back to Account</a>
	{/if}

	{#if account.error}<p class="error" role="alert">{account.error}</p>{/if}
	{#if finished && !result}
		<a class="btn btn-block next" href={resolve('/account')}>Back to Account</a>
	{/if}
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

	.actions {
		display: grid;
		margin: 16px 0;
	}

	.next {
		margin-top: 8px;
	}
</style>
