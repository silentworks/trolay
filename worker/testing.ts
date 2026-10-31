import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { handleApi } from './api.ts';
import type { Env } from './env.ts';
import { FakeAuthenticator } from './fake-authenticator.ts';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

/** The statements of a migration file: comments dropped, split on the semicolons. */
function statements(sql: string): string[] {
	return sql
		.split('\n')
		.filter((line) => !line.trim().startsWith('--'))
		.join('\n')
		.split(';')
		.map((statement) => statement.trim())
		.filter(Boolean);
}

export interface TestEnv {
	env: Env;
	dispose(): Promise<void>;
}

/**
 * A real local D1 (the same SQLite that `wrangler dev` runs) in a temporary folder, with every
 * migration applied, so tests exercise the real schema.
 */
export async function createTestEnv(): Promise<TestEnv> {
	const persist = mkdtempSync(join(tmpdir(), 'trolay-d1-'));
	const proxy = await getPlatformProxy<Env>({ persist: { path: persist } });
	const files = readdirSync(MIGRATIONS)
		.filter((name) => name.endsWith('.sql'))
		.sort();
	for (const file of files) {
		const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
		await proxy.env.DB.batch(statements(sql).map((statement) => proxy.env.DB.prepare(statement)));
	}
	return {
		// The Durable Object only runs under a real Worker (the end-to-end tests); here the trip
		// rooms are left out, and the API skips them.
		env: { ...proxy.env, TRIPS: undefined },
		dispose: async () => {
			await proxy.dispose();
			rmSync(persist, { recursive: true, force: true });
		}
	};
}

export const ORIGIN = 'https://trolay.test';
export const RP_ID = 'trolay.test';

export interface Reply {
	status: number;
	// Untyped on purpose: each test reads the few fields of the JSON it cares about.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	body: any;
	/** The cookie as a browser would send it back: name=value. */
	cookie?: string;
	setCookie?: string;
}

export interface CallOptions {
	method?: string;
	body?: unknown;
	cookie?: string;
	/** The Origin header; null leaves it out. */
	origin?: string | null;
	type?: string;
	headers?: Record<string, string>;
}

/** Calls the API in-process, the way the browser would, plus passkey helpers for tests. */
export function testClient(env: Env) {
	async function call(path: string, options: CallOptions = {}): Promise<Reply> {
		const headers: Record<string, string> = { ...options.headers };
		if (options.origin !== null) headers.Origin = options.origin ?? ORIGIN;
		if (options.cookie) headers.Cookie = options.cookie;
		if (options.body !== undefined) headers['Content-Type'] = options.type ?? 'application/json';
		const response = await handleApi(
			new Request(ORIGIN + path, {
				method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
				headers,
				body: options.body === undefined ? undefined : JSON.stringify(options.body)
			}),
			env
		);
		const setCookie = response.headers.get('Set-Cookie') ?? undefined;
		return {
			status: response.status,
			body: await response.json(),
			setCookie,
			cookie: setCookie?.split(';')[0]
		};
	}

	/** Makes a new account with a fresh authenticator, signed in. */
	async function register(authenticator = new FakeAuthenticator(RP_ID, ORIGIN), cookie?: string) {
		const start = await call('/api/auth/register/options', { method: 'POST', body: {}, cookie });
		const credential = await authenticator.create(start.body.options);
		const done = await call('/api/auth/register/verify', {
			body: { challengeId: start.body.challengeId, credential },
			cookie
		});
		return { authenticator, start, done };
	}

	async function signIn(authenticator: FakeAuthenticator, lies = {}) {
		const start = await call('/api/auth/login/options', { method: 'POST', body: {} });
		const credential = await authenticator.get(start.body.options, lies);
		return {
			start,
			credential,
			done: await call('/api/auth/login/verify', {
				body: { challengeId: start.body.challengeId, credential }
			})
		};
	}

	return { call, register, signIn };
}
