import { self } from '$app/service-worker';
import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';

// Precaches the app shell so the app works with no signal after its first load. Each build
// gets its own cache; the old one is removed once the new worker takes over.
const CACHE = `trolley-${version}`;

// The SPA fallback page that every navigation is served from.
const SHELL = new URL('./', self.registration.scope).href;

// Cloudflare Pages config files are never served, and one failed fetch would abort the install.
const NOT_SERVED = new Set(['_headers', '_redirects']);

const PRECACHE = [
	SHELL,
	...[...immutable, ...assets]
		.filter(({ path }) => !NOT_SERVED.has(path))
		.map(({ path }) => new URL(path, self.registration.scope).href)
];
const PRECACHED = new Set(PRECACHE);

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
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

	// Cache-first: the cache only ever holds this build's files, so it is never stale.
	// Navigations get the app shell, which routes in the browser.
	const key = request.mode === 'navigate' ? SHELL : url.href;
	if (!PRECACHED.has(key)) return;

	event.respondWith(
		(async () => {
			const cached = await caches.match(key, { cacheName: CACHE });
			return cached ?? fetch(request);
		})()
	);
});
