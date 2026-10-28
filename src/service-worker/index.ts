import { self } from '$app/service-worker';
import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';

// Precaches the app shell so the app works with no signal after its first load. Each build
// gets its own cache; the old one is removed once the new worker takes over.
const CACHE = `trolay-${version}`;

// The label reader's files (~24 MB of models and WebAssembly, under ocr/<content hash>/) live in
// a cache of their own that survives app updates, so a new build does not download them again.
const OCR_CACHE = 'trolay-ocr';
const isOcrFile = (path: string) => path.startsWith('ocr/');

// The SPA fallback page that every navigation is served from.
const SHELL = new URL('./', self.registration.scope).href;

// Cloudflare config files are never served, and one failed fetch would abort the install.
const NOT_SERVED = new Set(['_headers', '_redirects']);

const toUrl = (path: string) => new URL(path, self.registration.scope).href;
const files = [...immutable, ...assets].map(({ path }) => path).filter((p) => !NOT_SERVED.has(p));

const PRECACHE = [SHELL, ...files.filter((p) => !isOcrFile(p)).map(toUrl)];
const OCR_FILES = files.filter(isOcrFile).map(toUrl);
const PRECACHED = new Set(PRECACHE);
const OCR_PRECACHED = new Set(OCR_FILES);

/** Adds whichever label-reader files are missing. Never fails: they can be fetched later. */
async function cacheOcrFiles() {
	try {
		const cache = await caches.open(OCR_CACHE);
		for (const url of OCR_FILES) {
			if (!(await cache.match(url))) await cache.add(url);
		}
	} catch (error) {
		console.warn('Label reader files not cached yet:', error);
	}
}

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			await (await caches.open(CACHE)).addAll(PRECACHE);
			await cacheOcrFiles();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE && key !== OCR_CACHE) await caches.delete(key);
			}
			// Drop label-reader files from older versions.
			const ocr = await caches.open(OCR_CACHE);
			for (const request of await ocr.keys()) {
				if (!OCR_PRECACHED.has(request.url)) await ocr.delete(request);
			}
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;

	// Cache-first: the caches only ever hold this build's files, so they are never stale.
	// Navigations get the app shell, which routes in the browser.
	const key = request.mode === 'navigate' ? SHELL : url.href;

	if (PRECACHED.has(key)) {
		event.respondWith(
			(async () => (await caches.match(key, { cacheName: CACHE })) ?? fetch(request))()
		);
	} else if (OCR_PRECACHED.has(key)) {
		// Stored on first use if the install-time download did not finish.
		event.respondWith(
			(async () => {
				const cache = await caches.open(OCR_CACHE);
				const cached = await cache.match(key);
				if (cached) return cached;
				const response = await fetch(request);
				if (response.ok) await cache.put(key, response.clone());
				return response;
			})()
		);
	}
});
