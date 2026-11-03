// Runs the API Worker on :8787 (API_PORT) with a local database, creating it if it does not
// exist yet.
// `vite dev` proxies /api to it (vite.config.ts).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

// wrangler insists the assets folder exists, even though the API never serves from it in dev.
mkdirSync('build', { recursive: true });

// Run wrangler directly (not through `pnpm exec`) so a signal sent to this script reaches it.
const wrangler = 'node_modules/.bin/wrangler';
// The end-to-end tests run their own API on another port, on a database that starts empty.
const port = process.env.API_PORT ?? '8787';
const persist = process.env.API_PERSIST ? ['--persist-to', process.env.API_PERSIST] : [];
if (process.env.API_PERSIST && process.env.API_FRESH) {
	rmSync(process.env.API_PERSIST, { recursive: true, force: true });
}
const migrate = spawnSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', ...persist], {
	stdio: 'inherit'
});
if (migrate.status !== 0) process.exit(1);

const worker = spawn(wrangler, ['dev', '--port', port, ...persist], { stdio: 'inherit' });
worker.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => worker.kill(signal));
