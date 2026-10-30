// Runs the app (vite, :5173) and the API (wrangler, :8787) together; Ctrl+C stops both.
import { spawn } from 'node:child_process';

const children = [
	spawn('node', ['scripts/dev-api.js'], { stdio: 'inherit' }),
	spawn('node_modules/.bin/vite', ['dev'], { stdio: 'inherit' })
];
const stop = (signal = 'SIGTERM') => children.forEach((child) => child.kill(signal));
for (const child of children) child.on('exit', () => stop());
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal));
