<script lang="ts">
	import { account } from '#lib/auth/account.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import SettingsGroup from './SettingsGroup.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import Sheet from './Sheet.svelte';

	// Deleting the account: a sheet says what goes, and the shopper confirms with their passkey.
	let open = $state(false);
	let removeFromPhone = $state(false);

	const TRASH = ['M5 7h14', 'M9 7V4h6v3', 'M7 7l1 13h8l1-13'];

	async function confirm() {
		if (!(await account.deleteAccount(removeFromPhone))) return;
		open = false;
		toast.show({ message: 'Your account is deleted.', tone: 'success' });
	}
</script>

<SettingsGroup>
	<SettingsRow
		label="Delete account"
		icon={TRASH}
		tone="danger"
		disabled={account.busy}
		onclick={() => {
			account.error = undefined;
			removeFromPhone = false;
			open = true;
		}}
	/>
</SettingsGroup>

<Sheet
	{open}
	title="Delete your account?"
	onclose={() => {
		open = false;
		account.error = undefined;
	}}
>
	<p>
		This deletes your Trolay account and everything synced to it: your stores, your trips and their
		items, and any photos kept in the cloud. It can't be undone.
	</p>
	<ul class="notes">
		<li>
			Your partner is taken off any trip you share. If it's finished, it stays in their history.
		</li>
		<li>Trips you joined as a partner stay with their owner.</li>
		<li>Other phones signed in to this account are signed out.</li>
	</ul>
	<div class="form-rows">
		<div class="form-row">
			<span id="remove-label">Trips and stores on this phone</span>
			<button
				class="toggle-pill"
				type="button"
				role="switch"
				aria-checked={removeFromPhone}
				aria-labelledby="remove-label"
				aria-describedby="remove-hint"
				onclick={() => (removeFromPhone = !removeFromPhone)}
			>
				{removeFromPhone ? 'Remove' : 'Keep'}
			</button>
		</div>
	</div>
	<p class="hint" id="remove-hint">
		{removeFromPhone
			? 'They are removed from this phone too.'
			: 'You can go on using them on this phone without an account.'}
	</p>
	<p class="hint">You'll be asked for your passkey. You can remove it from your passwords after.</p>
	{#if account.error}<p class="error" role="alert">{account.error}</p>{/if}
	<button
		class="btn btn-danger btn-block"
		type="button"
		disabled={account.busy}
		onclick={() => void confirm()}
	>
		Delete account
	</button>
</Sheet>

<style>
	.notes {
		padding-left: 1.25em;
	}

	.notes li + li {
		margin-top: 4px;
	}

	.hint {
		color: var(--muted);
	}
</style>
