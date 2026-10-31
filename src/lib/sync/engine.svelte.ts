import { liveQuery } from 'dexie';
import { account } from '#lib/auth/account.svelte.ts';
import { db } from '#lib/data/db.ts';
import { SignedOutError, SyncCore } from './core.ts';
import { PhotoSync } from './photos.ts';

export type SyncStatus = 'off' | 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

/**
 * After a change, wait this long for the shopper to stop tapping before sending. Short, so that
 * on a shared trip a change reaches the other phone within a couple of seconds.
 */
const SETTLE_MS = 400;
/** While the app is open, look for changes made on other devices this often. */
const POLL_MS = 60_000;
/** After a round fails for lack of signal, try again this soon. */
const RETRY_MS = 10_000;

class SyncEngine {
	/** The store of a trip this phone was just taken off, for saying so; cleared once shown. */
	removedFrom = $state<string>();
	private readonly core = new SyncCore(db, undefined, (stores) => (this.removedFrom = stores[0]));
	private readonly photos = new PhotoSync(db);
	private timer: ReturnType<typeof setTimeout> | undefined;
	private again = false;

	/** Records with changes still to send. */
	pending = $state(0);
	syncing = $state(false);
	online = $state(true);
	failed = $state(false);
	lastSyncedAt = $state<number>();
	/** How many records this round started with to send, to show progress through a big upload. */
	started = $state(0);

	status = $derived.by<SyncStatus>(() => {
		if (account.status === 'signedOut') return 'off';
		// Signed in last time, and not able to ask now: offline, with changes waiting.
		if (account.status === 'unknown') return account.maybeSignedIn ? 'offline' : 'off';
		if (this.syncing) return 'syncing';
		if (!this.online) return 'offline';
		if (this.failed) return 'error';
		return this.pending > 0 ? 'pending' : 'synced';
	});

	/** Records sent so far in this round. */
	sent = $derived(Math.max(0, this.started - this.pending));

	/**
	 * Keeps the count of changes waiting up to date, for showing; returns the function that stops
	 * it. When signed in, a change also starts a round once the shopper has stopped making them.
	 */
	watch(): () => void {
		const changes = liveQuery(() => this.core.pendingCount()).subscribe({
			next: (count) => {
				this.pending = count;
				if (count > 0 && account.status === 'signedIn') this.schedule(SETTLE_MS);
			},
			error: (error) => console.error(error)
		});
		return () => changes.unsubscribe();
	}

	/**
	 * Starts syncing for the signed-in user; returns the function that stops it. Syncs when the
	 * signal returns, when the app is opened again, and now and then while it is open.
	 */
	start(): () => void {
		const wentOnline = () => {
			this.online = true;
			this.schedule(0);
		};
		const wentOffline = () => (this.online = false);
		const shown = () => document.visibilityState === 'visible' && this.schedule(0);
		const poll = setInterval(shown, POLL_MS);
		window.addEventListener('online', wentOnline);
		window.addEventListener('offline', wentOffline);
		document.addEventListener('visibilitychange', shown);

		this.online = navigator.onLine;
		this.schedule(0);
		return () => {
			clearInterval(poll);
			clearTimeout(this.timer);
			window.removeEventListener('online', wentOnline);
			window.removeEventListener('offline', wentOffline);
			document.removeEventListener('visibilitychange', shown);
		};
	}

	private schedule(delay: number): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => void this.syncNow(), delay);
	}

	/**
	 * One round now, or, if one is running, another straight after it. Resolves when the round
	 * (and the one after it, if asked for) has finished, however it ended.
	 */
	syncNow(): Promise<void> {
		if (this.syncing) {
			this.again = true;
			return this.running;
		}
		if (account.status !== 'signedIn' || !account.userId) return Promise.resolve();
		this.syncing = true;
		this.running = this.rounds(account.userId);
		return this.running;
	}

	private running: Promise<void> = Promise.resolve();

	/**
	 * Photos on a shared trip, after the trip's records. Having no signal is passed on (the round
	 * is retried when it returns); any other trouble with photos is not worth showing as a sync
	 * failure, and they are tried again next round.
	 */
	private async sharePhotos(): Promise<void> {
		try {
			await this.photos.run();
		} catch (error) {
			if (error instanceof TypeError) throw error;
			console.warn('Photos on the shared trip:', error);
		}
	}

	private async rounds(userId: string): Promise<void> {
		try {
			await this.core.adopt(userId);
			do {
				this.again = false;
				this.started = await this.core.pendingCount();
				await this.core.run();
				await this.sharePhotos();
			} while (this.again);
			this.failed = false;
			this.online = true;
			this.lastSyncedAt = Date.now();
		} catch (error) {
			if (error instanceof SignedOutError) account.sessionEnded();
			// A failed fetch (no signal) throws a TypeError; anything else is the server's trouble.
			else if (error instanceof TypeError) {
				this.online = false;
				this.schedule(RETRY_MS);
			} else {
				this.failed = true;
				console.warn(error);
			}
		} finally {
			this.syncing = false;
			this.started = 0;
		}
	}
}

export const syncEngine = new SyncEngine();
