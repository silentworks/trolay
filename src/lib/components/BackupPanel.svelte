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
	import { toast } from '#lib/toast.svelte.ts';
	import SettingsGroup from './SettingsGroup.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import Sheet from './Sheet.svelte';

	let fileInput = $state<HTMLInputElement>();
	// Raw, not deeply reactive: IndexedDB cannot store the proxies $state wraps objects in.
	let pending = $state.raw<{ backup: Backup; summary: BackupSummary; current: number }>();
	let problem = $state<string>();
	let busy = $state(false);

	const DOWNLOAD = ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'];
	const UPLOAD = ['M12 15V4', 'M7 9l5-5 5 5', 'M5 20h14'];

	const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

	async function download() {
		problem = undefined;
		try {
			const backup = await createBackup();
			saveFile(`trolay-backup-${localDate()}.json`, JSON.stringify(backup), 'application/json');
		} catch (error) {
			problem = `The backup could not be made: ${String(error)}`;
		}
	}

	async function picked(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		problem = undefined;
		try {
			const backup = readBackup(await file.text());
			const current = (await db.trips.toArray()).filter(isLive).length;
			pending = { backup, summary: summarise(backup), current };
		} catch (error) {
			problem = error instanceof Error ? error.message : String(error);
		}
	}

	async function restore() {
		if (!pending || busy) return;
		busy = true;
		try {
			await restoreBackup(pending.backup);
			toast.show({ message: 'Backup restored', tone: 'success' });
			pending = undefined;
		} catch (error) {
			problem = `Nothing was changed: ${String(error)}`;
			pending = undefined;
		} finally {
			busy = false;
		}
	}
</script>

<SettingsGroup
	title="Backup"
	note="Your stores, trips and items live only on this phone. Keep a backup file somewhere safe, or use it to move to a new phone. Restoring one replaces what's on this phone."
>
	<SettingsRow label="Download backup" icon={DOWNLOAD} onclick={download} />
	<SettingsRow label="Restore a backup" icon={UPLOAD} onclick={() => fileInput?.click()} />
</SettingsGroup>
{#if problem}<p class="error" role="alert">{problem}</p>{/if}
<input
	bind:this={fileInput}
	class="visually-hidden"
	type="file"
	accept="application/json,.json"
	tabindex="-1"
	aria-hidden="true"
	onchange={picked}
/>

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
	.error {
		margin: 12px 0 0;
	}

	.warning {
		padding: 10px 12px;
		border-radius: var(--radius);
		background: var(--warning-bg);
		color: var(--warning-text);
		font-weight: 600;
	}
</style>
