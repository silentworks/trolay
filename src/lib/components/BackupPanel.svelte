<script lang="ts">
	import { formatWhen } from '#lib/dates.ts';
	import { db, isLive } from '#lib/data/db.ts';
	import {
		createBackup,
		readBackup,
		restoreBackup,
		summarise,
		type Backup,
		type BackupSummary
	} from '#lib/export/backup.ts';
	import { localDate, saveFile } from '#lib/export/download.ts';
	import Sheet from './Sheet.svelte';

	let fileInput = $state<HTMLInputElement>();
	// Raw, not deeply reactive: IndexedDB cannot store the proxies $state wraps objects in.
	let pending = $state.raw<{ backup: Backup; summary: BackupSummary; current: number }>();
	let message = $state<{ text: string; error?: boolean }>();
	let busy = $state(false);

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

	async function download() {
		message = undefined;
		try {
			const backup = await createBackup();
			saveFile(`trolay-backup-${localDate()}.json`, JSON.stringify(backup), 'application/json');
		} catch (error) {
			message = { text: `The backup could not be made: ${String(error)}`, error: true };
		}
	}

	async function picked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		message = undefined;
		try {
			const backup = readBackup(await file.text());
			const current = (await db.trips.toArray()).filter(isLive).length;
			pending = { backup, summary: summarise(backup), current };
		} catch (error) {
			message = { text: error instanceof Error ? error.message : String(error), error: true };
		}
	}

	async function restore() {
		if (!pending || busy) return;
		busy = true;
		try {
			await restoreBackup(pending.backup);
			message = { text: 'Backup restored.' };
			pending = undefined;
		} catch (error) {
			message = { text: `Nothing was changed: ${String(error)}`, error: true };
			pending = undefined;
		} finally {
			busy = false;
		}
	}
</script>

<section class="backup" aria-labelledby="backup-heading">
	<h2 id="backup-heading">Backup</h2>
	<p class="hint">
		Your stores, trips and items live only on this phone. Keep a backup file somewhere safe, or use
		it to move to a new phone.
	</p>
	<div class="actions">
		<button class="btn" type="button" onclick={download}>Download backup</button>
		<button class="btn" type="button" onclick={() => fileInput?.click()}>Restore a backup</button>
	</div>
	{#if message}
		<p class={message.error ? 'error' : 'done'} role={message.error ? 'alert' : 'status'}>
			{message.text}
		</p>
	{/if}
	<input
		bind:this={fileInput}
		class="visually-hidden"
		type="file"
		accept="application/json,.json"
		tabindex="-1"
		aria-hidden="true"
		onchange={picked}
	/>
</section>

<Sheet
	open={pending !== undefined}
	title="Restore this backup?"
	onclose={() => (pending = undefined)}
>
	{#if pending}
		{@const s = pending.summary}
		<p>
			The backup from {formatWhen(Date.parse(s.exportedAt))} has {plural(s.stores, 'store')},
			{plural(s.trips, 'trip')} and {plural(s.items, 'item')}{s.photos
				? `, with ${plural(s.photos, 'photo')}`
				: ''}.
		</p>
		<p class="warning">
			It replaces everything on this phone{pending.current
				? `, including ${plural(pending.current, 'trip')}`
				: ''}. This can't be undone.
		</p>
		<button class="btn btn-danger btn-block" type="button" disabled={busy} onclick={restore}>
			Replace with the backup
		</button>
	{/if}
</Sheet>

<style>
	.backup {
		margin-top: 32px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	h2 {
		font-size: 1.15rem;
	}

	.hint {
		color: var(--muted);
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.done {
		color: var(--accent);
		font-weight: 700;
	}

	.warning {
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--warning-bg);
		color: var(--warning-text);
		font-weight: 600;
	}
</style>
