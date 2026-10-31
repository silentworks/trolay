<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import { account } from '#lib/auth/account.svelte.ts';
	import {
		forgetInvite,
		InviteError,
		joinTrip,
		pendingInvite,
		rememberInvite,
		type JoinedTrip
	} from '#lib/sharing/invites.ts';

	let token = $state<string>();
	let joined = $state<JoinedTrip>();
	let error = $state<string>();
	let busy = $state(false);
	let ready = $state(false);

	onMount(async () => {
		// The token is in the address's fragment, so it never reached the server in the request for
		// this page. Take it out of the address bar, and keep it for this tab only.
		const fromLink = new URLSearchParams(location.hash.slice(1)).get('token');
		history.replaceState(history.state, '', location.pathname);
		if (fromLink) rememberInvite(fromLink);
		token = fromLink ?? pendingInvite();
		// Who is signed in is asked of the server by the app's layout; ask now so it is known.
		if (account.status === 'unknown') await account.refresh();
		ready = true;
	});

	async function join() {
		if (!token || busy) return;
		busy = true;
		error = undefined;
		try {
			joined = await joinTrip(token);
			forgetInvite();
		} catch (cause) {
			error = cause instanceof InviteError ? cause.message : 'Something went wrong. Try again.';
			// A link that can never work is not worth keeping.
			if (
				cause instanceof InviteError &&
				cause.code !== 'offline' &&
				cause.code !== 'unauthorized'
			) {
				forgetInvite();
				token = undefined;
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Join a trip · Trolay</title></svelte:head>

<div class="page">
	<AppHeader title="Join a trip" back={{ href: resolve('/'), label: 'Trolley' }} />

	{#if !ready}
		<p class="hint" role="status">One moment…</p>
	{:else if joined}
		<p class="status" role="status">
			You've joined the trip at {joined.store.name}{joined.store.branch
				? `, ${joined.store.branch}`
				: ''}.
		</p>
		<p class="hint">It will appear on your phone once your account has synced.</p>
		<a class="btn btn-block next" href={resolve('/')}>Continue</a>
	{:else if !token}
		<p class="hint">
			This page opens from an invite link. Ask the person who invited you to send the link again.
		</p>
		<a class="btn btn-block next" href={resolve('/')}>Back to your trolley</a>
	{:else if account.status === 'signedIn'}
		<p>You've been invited to share a shopping trip.</p>
		<button class="btn btn-primary btn-block" type="button" disabled={busy} onclick={join}>
			Join the trip
		</button>
	{:else}
		<p>You've been invited to share a shopping trip.</p>
		<p class="hint">
			Sign in to Trolay to accept. Your invite waits here while you do, and you can come back to
			this page afterwards.
		</p>
		<a class="btn btn-primary btn-block next" href={resolve('/account')}>Sign in</a>
	{/if}

	{#if error}<p class="error" role="alert">{error}</p>{/if}
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

	.next {
		margin-top: 8px;
	}
</style>
