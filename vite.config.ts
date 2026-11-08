import { defaultClientConditions, type Connect, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { ocrAssetsId } from './scripts/ocr-assets.js';

/** The headers static/_headers gives every page in production. Keep the two the same. */
const PAGE_HEADERS = {
	'Cross-Origin-Opener-Policy': 'same-origin',
	'Cross-Origin-Embedder-Policy': 'require-corp',
	'Content-Security-Policy': "frame-ancestors 'none'",
	'X-Frame-Options': 'DENY',
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'same-origin'
};

/**
 * The same headers as production (static/_headers), so OCR can use threads in development and
 * tests too, and the tests run under the same rules. Set by middleware because SvelteKit's
 * preview server answers before Vite's own `preview.headers` are applied.
 */
function crossOriginIsolation(): Plugin {
	const middleware: Connect.NextHandleFunction = (_req, res, next) => {
		for (const [name, value] of Object.entries(PAGE_HEADERS)) res.setHeader(name, value);
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
				changeOrigin: false,
				// Live trip updates are a WebSocket.
				ws: true
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
			adapter: adapter({ fallback: 'index.html' }),

			// Absolute asset paths, as in the built index.html. Relative ones depend on how deep the
			// URL is, and the service worker serves one cached shell for every URL.
			paths: { relative: false },

			// What the page may load and run, as a <meta> in index.html. SvelteKit adds the hash of
			// its own start-up script; there are no other inline scripts. A <meta> policy cannot
			// refuse framing, so in production the header in static/_headers does; SvelteKit's
			// preview server sends this policy as a header, frame-ancestors and all.
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					// The label reader and barcode reader run WebAssembly. Turnstile, the feedback form's
					// bot check, is a script and a frame from Cloudflare.
					'script-src': ['self', 'wasm-unsafe-eval', 'https://challenges.cloudflare.com'],
					'frame-src': ['https://challenges.cloudflare.com'],
					'worker-src': ['self', 'blob:'],
					// Svelte sets style attributes (style:width and the like).
					'style-src': ['self', 'unsafe-inline'],
					// Photos are shown from blobs on the phone.
					'img-src': ['self', 'blob:', 'data:'],
					'media-src': ['self', 'blob:'],
					// The API and its live WebSocket are this origin; product names come from Open Food Facts.
					'connect-src': ['self', 'https://world.openfoodfacts.org'],
					'font-src': ['self'],
					'manifest-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					'form-action': ['self'],
					'frame-ancestors': ['none']
				}
			}
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
