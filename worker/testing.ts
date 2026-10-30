import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import type { Env } from './env.ts';

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
		env: proxy.env,
		dispose: async () => {
			await proxy.dispose();
			rmSync(persist, { recursive: true, force: true });
		}
	};
}
