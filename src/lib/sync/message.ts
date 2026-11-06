import type { SyncStatus } from './engine.svelte.ts';

export interface SyncState {
	status: SyncStatus;
	pending: number;
	stuck: boolean;
	started: number;
	sent: number;
}

const plural = (n: number) => `${n} change${n === 1 ? '' : 's'}`;

/** What syncing is doing, in words: for the Account page, and read out by the header's icon. */
export function syncMessage({ status, pending, stuck, started, sent }: SyncState): string {
	switch (status) {
		case 'syncing':
			// A big first upload shows how far it has got; a small one is over before it could be read.
			return started > 25 ? `Uploading ${sent} of ${started}…` : 'Syncing…';
		case 'offline':
			return `Offline. ${pending ? `${plural(pending)} will` : 'Changes will'} sync when you're back online.`;
		case 'error':
			return "Couldn't sync just now. It will try again.";
		case 'pending':
			return stuck
				? `${plural(pending)} couldn't be sent yet. It will keep trying.`
				: `${plural(pending)} waiting to sync.`;
		case 'synced':
			return '✓ Synced';
		default:
			return '';
	}
}
