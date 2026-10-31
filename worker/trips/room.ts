import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';

/**
 * The live state of one open trip: who is connected, and a version that goes up each time the
 * trip changes. A phone that connects is told the version; one that missed changes while its
 * connection was down syncs when it reconnects, which is how it catches up.
 *
 * Sockets use the hibernation API, so an idle trip costs nothing while the room sleeps.
 */
export class TripRoom extends DurableObject<Env> {
	async fetch(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (pathname === '/changed' && request.method === 'POST') {
			const { over } = (await request.json()) as { over?: boolean };
			return this.changed(over === true);
		}
		if (pathname === '/connect' && request.headers.get('Upgrade') === 'websocket') {
			const { 0: client, 1: server } = new WebSocketPair();
			this.ctx.acceptWebSocket(server);
			server.send(JSON.stringify({ type: 'hello', version: await this.version() }));
			return new Response(null, { status: 101, webSocket: client });
		}
		return new Response('not found', { status: 404 });
	}

	private async version(): Promise<number> {
		return (await this.ctx.storage.get<number>('version')) ?? 0;
	}

	private async changed(over: boolean): Promise<Response> {
		const version = (await this.version()) + 1;
		await this.ctx.storage.put('version', version);
		const message = JSON.stringify({ type: over ? 'over' : 'changed', version });
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(message);
				// A finished trip has nothing more to say: let the phones go.
				if (over) socket.close(1000, 'trip over');
			} catch {
				// A socket that has gone away is dropped by the runtime.
			}
		}
		return new Response(null, { status: 204 });
	}

	// Phones only listen; anything they send is ignored, and a ping is answered.
	webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
		if (message === 'ping') socket.send('pong');
	}

	webSocketClose(socket: WebSocket, code: number): void {
		// 1005 and 1006 cannot be echoed back in a close frame.
		socket.close(code === 1005 || code === 1006 ? 1000 : code);
	}
}
