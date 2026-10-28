import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

// The label reader's files are served from static/ocr/<version>/ (scripts/copy-ocr-assets.js).
const { version: tesseractVersion } = createRequire(import.meta.url)('tesseract.js/package.json');

export default defineConfig({
	define: { __TESSERACT_VERSION__: JSON.stringify(tesseractVersion) },
	plugins: [
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
