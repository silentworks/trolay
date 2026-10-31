<script lang="ts">
	import { onMount } from 'svelte';
	import { account } from '#lib/auth/account.svelte.ts';
	import { createInviteLink, explainMissingTrip, InviteError } from '#lib/sharing/invites.ts';
	import { syncEngine } from '#lib/sync/engine.svelte.ts';

	interface Props {
		tripId: string;
	}

	let { tripId }: Props = $props();
	const uid = $props.id();

	let link = $state<string>();
	let error = $state<string>();
	let busy = $state(false);
	let copied = $state(false);
	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	async function make() {
		busy = true;
		error = undefined;
		copied = false;
		try {
			// Right after the app opens, who is signed in may still be being asked.
			if (account.status === 'unknown') await account.refresh();
			if (account.status !== 'signedIn') {
				error = 'Sign in on the Account page to share this trip.';
				return;
			}
			// The trip has to be on the server before anyone can be let into it.
			await syncEngine.syncNow();
			link = await createInviteLink(tripId);
		} catch (cause) {
			error = await explain(cause);
		} finally {
			busy = false;
		}
	}

	/** The server not having the trip has several causes; say which one it is. */
	async function explain(cause: unknown): Promise<string> {
		if (!(cause instanceof InviteError)) return 'Something went wrong. Try again.';
		if (cause.code !== 'trip_not_found') return cause.message;
		return explainMissingTrip({
			refused: await syncEngine.wasRefused('trips', tripId),
			sync: syncEngine.status,
			pending: syncEngine.pending
		});
	}

	onMount(() => void make());

	async function copy() {
		if (!link) return;
		try {
			await navigator.clipboard.writeText(link);
			copied = true;
		} catch {
			// Clipboard access can be refused; the link is in the box to copy by hand.
			(document.getElementById(`${uid}-link`) as HTMLInputElement | null)?.select();
		}
	}

	async function share() {
		if (!link) return;
		try {
			await navigator.share({ title: 'Join my trolley on Trolay', url: link });
		} catch {
			// Cancelled.
		}
	}
</script>

<div class="invite">
	<p class="hint">
		Send this link to the person shopping with you. It works once, for one person, and expires in a
		day. They'll need to sign in to Trolay to accept.
	</p>

	{#if busy && !link}
		<p role="status">Making a link…</p>
	{/if}

	{#if link}
		<div class="field">
			<label for="{uid}-link">Invite link</label>
			<input
				id="{uid}-link"
				class="input"
				readonly
				value={link}
				onfocus={(e) => e.currentTarget.select()}
			/>
		</div>
		<div class="actions">
			{#if canShare}
				<button class="btn btn-primary" type="button" onclick={share}>Share the link</button>
			{/if}
			<button class="btn" class:btn-primary={!canShare} type="button" onclick={copy}>
				Copy link
			</button>
		</div>
		{#if copied}<p class="copied" role="status">Link copied.</p>{/if}
		<button class="btn btn-block again" type="button" disabled={busy} onclick={make}>
			Make a new link
		</button>
		<p class="hint">A new link replaces this one.</p>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
		<button class="btn btn-block again" type="button" disabled={busy} onclick={make}
			>Try again</button
		>
	{/if}
</div>

<style>
	.hint {
		color: var(--muted);
	}

	.actions {
		display: grid;
		gap: 8px;
	}

	.copied {
		font-weight: 700;
		color: var(--accent);
	}

	.again {
		margin-top: 8px;
	}
</style>
