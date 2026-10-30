import { defaultClientConditions, type Connect, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { ocrAssetsId } from './scripts/ocr-assets.js';

const CROSS_ORIGIN_ISOLATION = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp'
};

/**
 * The same cross-origin isolation as production (static/_headers), so OCR can use threads in
 * development and tests too. Set by middleware because SvelteKit's preview server answers before
 * Vite's own `preview.headers` are applied.
 */
function crossOriginIsolation(): Plugin {
	const middleware: Connect.NextHandleFunction = (_req, res, next) => {
		for (const [name, value] of Object.entries(CROSS_ORIGIN_ISOLATION)) res.setHeader(name, value);
		next();
	};
	return {
		name: 'cross-origin-isolation',
		configureServer: (server) => void server.middlewares.use(middleware),
		configurePreviewServer: (server) => void server.middlewares.use(middleware)
	};
}

export default defineConfig({
	// The label reader's files are served from static/ocr/<id>/ (scripts/copy-ocr-assets.js).
	define: { __OCR_ASSETS_ID__: JSON.stringify(ocrAssetsId()) },
	// onnxruntime-web's unbundled build: it loads its WebAssembly and loader from static/ocr/,
	// and can then start its own thread workers (the bundled build cannot inside our worker).
	resolve: { conditions: [...defaultClientConditions, 'onnxruntime-web-use-extern-wasm'] },
	worker: { format: 'es' },
	// In development the API runs separately (`pnpm dev:api`) and the app reaches it on its own
	// origin, as in production, so neither needs CORS.
	server: {
		proxy: {
			'/api': {
				target: `http://localhost:${process.env.API_PORT ?? 8787}`,
				// Keep the browser's own Host, so the API sees the origin the browser used (passkeys
				// are bound to it).
				changeOrigin: false
			}
		}
	},
	plugins: [
		crossOriginIsolation(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			// SPA mode: every route renders in the browser (`ssr = false` in the root layout) and
			// unknown paths fall back to index.html, which Cloudflare serves for any URL that has
			// no file of its own.
			adapter: adapter({ fallback: 'index.html' })
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				// The Worker's tests run against a real local D1 (worker/testing.ts).
				test: { name: 'worker', environment: 'node', include: ['worker/**/*.spec.ts'] }
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
