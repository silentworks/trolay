// New versions of the app arrive as a new service worker, which installs in the background and
// then waits. It is never switched to on its own: a reload mid-shop would lose the shopper's
// place, so the app offers "Refresh to update" and reloads only when they tap it. Dismissed, the
// new version takes over the next time the app is opened from scratch.

class AppUpdate {
	/** A new version is installed and waiting. */
	available = $state(false);
	#waiting: ServiceWorker | undefined;
	#requested = false;

	/** Starts watching for new versions; returns a function that stops. */
	watch(): () => void {
		if (!('serviceWorker' in navigator)) return () => {};
		const container = navigator.serviceWorker;
		let registration: ServiceWorkerRegistration | undefined;
		let stopped = false;

		const offer = (worker: ServiceWorker) => {
			// With no controller this is the first install, not an update.
			if (stopped || !container.controller) return;
			this.#waiting = worker;
			this.available = true;
		};
		const track = (worker: ServiceWorker | null) => {
			if (!worker) return;
			if (worker.state === 'installed') offer(worker);
			else
				worker.addEventListener('statechange', () => worker.state === 'installed' && offer(worker));
		};

		container.ready.then((ready) => {
			if (stopped) return;
			registration = ready;
			track(ready.waiting);
			track(ready.installing);
			ready.addEventListener('updatefound', () => track(ready.installing));
		});

		// The new worker took over because this page asked it to: reload into the new version.
		// Another tab's request must not reload this one.
		const changed = () => {
			if (this.#requested) location.reload();
		};
		container.addEventListener('controllerchange', changed);

		// Look for a new version whenever the app comes back to the foreground.
		const check = () => {
			if (document.visibilityState === 'visible') registration?.update().catch(() => {});
		};
		document.addEventListener('visibilitychange', check);

		return () => {
			stopped = true;
			container.removeEventListener('controllerchange', changed);
			document.removeEventListener('visibilitychange', check);
		};
	}

	/** Switches to the new version and reloads; only ever called from the shopper's tap. */
	apply(): void {
		if (!this.#waiting) return;
		this.#requested = true;
		this.#waiting.postMessage({ type: 'SKIP_WAITING' });
	}

	dismiss(): void {
		this.available = false;
	}
}

export const appUpdate = new AppUpdate();
