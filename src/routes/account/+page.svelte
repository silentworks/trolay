<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { account } from '#lib/auth/account.svelte.ts';

	onMount(() => void account.refresh());
</script>

<svelte:head><title>Account · Trolay</title></svelte:head>

<div class="page">
	<AppHeader title="Account" back={{ href: resolve('/'), label: 'Trolley' }} />

	{#if account.status === 'signedIn'}
		<p class="status" role="status">You're signed in on this device.</p>
		<p class="hint">Sign in with a passkey on another device to use the same account there.</p>
		<div class="actions">
			<button class="btn" type="button" disabled={account.busy} onclick={() => account.register()}>
				Add a passkey on this device
			</button>
			<button class="btn" type="button" disabled={account.busy} onclick={() => account.signOut()}>
				Sign out
			</button>
		</div>
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
		gap: 8px;
		margin-top: 16px;
	}
</style>
