import { describe, expect, it } from 'vitest';
import { LiveTrip } from './live.ts';

/** A socket the test drives by hand. */
class FakeSocket {
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	closed = false;
	close() {
		this.closed = true;
	}
	send() {}
	open() {
		this.onopen?.(new Event('open'));
	}
	say(data: unknown) {
		this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
	}
	drop() {
		this.onclose?.({} as CloseEvent);
	}
}

function setup() {
	const sockets: FakeSocket[] = [];
	const urls: string[] = [];
	let syncs = 0;
	const waits: { ms: number; then: () => void; cancelled: boolean }[] = [];
	const live = new LiveTrip({
		sync: () => syncs++,
		url: (id) => `ws://x/live?trip=${id}`,
		open: (url) => {
			urls.push(url);
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		delay: (attempt) => 100 * 2 ** attempt,
		wait: (ms, then) => {
			const wait = { ms, then, cancelled: false };
			waits.push(wait);
			return () => (wait.cancelled = true);
		}
	});
	return { live, sockets, urls, waits, syncs: () => syncs };
}

describe('LiveTrip', () => {
	it('connects for the trip, and syncs on connecting and on each nudge', () => {
		const t = setup();
		t.live.connect('trip-1');
		expect(t.urls).toEqual(['ws://x/live?trip=trip-1']);
		t.sockets[0].open();
		expect(t.syncs()).toBe(1);
		t.sockets[0].say({ type: 'hello', version: 4 });
		expect(t.syncs()).toBe(1);
		t.sockets[0].say({ type: 'changed', version: 5 });
		t.sockets[0].say({ type: 'changed', version: 6 });
		expect(t.syncs()).toBe(3);
	});

	it('ignores messages it does not understand', () => {
		const t = setup();
		t.live.connect('trip-1');
		t.sockets[0].open();
		t.sockets[0].onmessage?.({ data: 'pong' } as MessageEvent);
		t.sockets[0].onmessage?.({ data: '{nope' } as MessageEvent);
		t.sockets[0].onmessage?.({ data: new ArrayBuffer(2) } as MessageEvent);
		expect(t.syncs()).toBe(1);
	});

	it('reconnects after a drop and syncs to catch up on what it missed', () => {
		const t = setup();
		t.live.connect('trip-1');
		t.sockets[0].open();
		t.sockets[0].drop();
		expect(t.waits).toHaveLength(1);
		expect(t.sockets).toHaveLength(1);
		t.waits[0].then();
		expect(t.sockets).toHaveLength(2);
		t.sockets[1].open();
		expect(t.syncs()).toBe(2);
	});

	it('backs off while a connection cannot be made, and starts again once one works', () => {
		const t = setup();
		t.live.connect('trip-1');
		t.sockets[0].drop();
		t.waits[0].then();
		t.sockets[1].drop();
		t.waits[1].then();
		t.sockets[2].drop();
		expect(t.waits.map((w) => w.ms)).toEqual([100, 200, 400]);
		t.waits[2].then();
		t.sockets[3].open();
		t.sockets[3].drop();
		expect(t.waits.at(-1)!.ms).toBe(100);
	});

	it('stops when told to, without reconnecting or syncing', () => {
		const t = setup();
		const stop = t.live.connect('trip-1');
		t.sockets[0].open();
		stop();
		expect(t.sockets[0].closed).toBe(true);
		t.sockets[0].drop();
		expect(t.waits).toHaveLength(0);
		// A pause that was already running does not open another socket.
		const t2 = setup();
		const stop2 = t2.live.connect('trip-1');
		t2.sockets[0].drop();
		stop2();
		expect(t2.waits[0].cancelled).toBe(true);
		t2.waits[0].then();
		expect(t2.sockets).toHaveLength(1);
	});

	it('syncs once more when the trip is over, and does not reconnect', () => {
		const t = setup();
		t.live.connect('trip-1');
		t.sockets[0].open();
		t.sockets[0].say({ type: 'over', version: 9 });
		expect(t.syncs()).toBe(2);
		t.sockets[0].drop();
		expect(t.waits).toHaveLength(0);
	});
});
