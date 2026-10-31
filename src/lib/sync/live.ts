// Live updates for an open trip. The server keeps a WebSocket open per phone on the trip and sends
// a nudge whenever the trip changes; a nudge only makes this phone sync, so the change arrives
// the way every change does, and nothing here can show anything the sync API would not.

type Socket = Pick<WebSocket, 'close' | 'send'> & {
	onopen: ((event: Event) => void) | null;
	onmessage: ((event: MessageEvent) => void) | null;
	onclose: ((event: CloseEvent) => void) | null;
	onerror: ((event: Event) => void) | null;
};

export interface LiveOptions {
	/** Sync now: called on connecting (to catch up on what was missed) and on every nudge. */
	sync: () => void;
	/** The address of the live socket for a trip. */
	url: (tripId: string) => string;
	open?: (url: string) => Socket;
	/** Waits before reconnecting (ms); defaults to backing off from 1 s to 30 s. */
	delay?: (attempt: number) => number;
	wait?: (ms: number, then: () => void) => () => void;
}

const BACKOFF = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);

/**
 * Keeps one socket open for one trip while connect() is in effect, reconnecting with a growing
 * pause when it drops. The pause restarts after a connection that lasted.
 */
export class LiveTrip {
	private readonly options: Required<LiveOptions>;

	constructor(options: LiveOptions) {
		this.options = {
			open: (url) => new WebSocket(url) as unknown as Socket,
			delay: BACKOFF,
			wait: (ms, then) => {
				const timer = setTimeout(then, ms);
				return () => clearTimeout(timer);
			},
			...options
		};
	}

	/** Connects for this trip; call the returned function to stop (leaving the trip, or signing out). */
	connect(tripId: string): () => void {
		let stopped = false;
		let socket: Socket | undefined;
		let cancelWait: (() => void) | undefined;
		let attempt = 0;

		const reconnect = () => {
			if (stopped) return;
			cancelWait = this.options.wait(this.options.delay(attempt++), open);
		};

		const open = () => {
			if (stopped) return;
			let opened = false;
			try {
				socket = this.options.open(this.options.url(tripId));
			} catch {
				reconnect();
				return;
			}
			socket.onopen = () => {
				opened = true;
				attempt = 0;
				// Whatever changed while there was no connection is fetched now.
				this.options.sync();
			};
			socket.onmessage = (event) => {
				const message = parse(event.data);
				if (message?.type === 'over') {
					// The trip finished: one last sync, and no more listening.
					stopped = true;
					this.options.sync();
					return;
				}
				if (message?.type === 'changed') this.options.sync();
			};
			socket.onclose = () => {
				socket = undefined;
				// A connection that never opened (the trip is not on the server yet, or there is no
				// signal) is retried with a growing pause; one that opened, straight away.
				if (opened) attempt = 0;
				reconnect();
			};
			socket.onerror = () => {};
		};

		open();
		return () => {
			stopped = true;
			cancelWait?.();
			const current = socket;
			socket = undefined;
			if (current) {
				current.onclose = null;
				current.close(1000, 'done');
			}
		};
	}
}

function parse(data: unknown): { type?: string } | undefined {
	if (typeof data !== 'string') return undefined;
	try {
		return JSON.parse(data);
	} catch {
		return undefined;
	}
}
