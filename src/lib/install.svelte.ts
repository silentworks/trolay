import { settings } from '#lib/settings.svelte.ts';

// Chrome and Edge offer to install the app with a `beforeinstallprompt` event; it is kept, and
// the install banner opens the browser's own install dialog with it. Safari has no such event,
// so on an iPhone the banner explains how to add the app to the Home Screen instead.

interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class Install {
	/** The browser has offered to install the app. */
	canPrompt = $state(false);
	installed = $state(
		typeof window !== 'undefined' &&
			(matchMedia('(display-mode: standalone)').matches ||
				(navigator as Navigator & { standalone?: boolean }).standalone === true)
	);
	readonly ios =
		typeof navigator !== 'undefined' &&
		(/iphone|ipad|ipod/i.test(navigator.userAgent) ||
			(navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
	#event: InstallPromptEvent | undefined;

	constructor() {
		if (typeof window === 'undefined') return;
		window.addEventListener('beforeinstallprompt', (event) => {
			// Kept for the banner, in place of the browser's own mini-infobar.
			event.preventDefault();
			this.#event = event as InstallPromptEvent;
			this.canPrompt = true;
		});
		window.addEventListener('appinstalled', () => {
			this.installed = true;
			this.canPrompt = false;
		});
	}

	/** There is a way to install the app here, and the shopper hasn't said no to it. */
	get offered(): boolean {
		return !this.installed && !settings.installNudgeDismissed && (this.canPrompt || this.ios);
	}

	/** Opens the browser's install dialog. Either answer puts the banner away for good. */
	async prompt(): Promise<void> {
		const event = this.#event;
		if (!event) return;
		this.#event = undefined;
		this.canPrompt = false;
		await event.prompt();
		await event.userChoice;
		settings.dismissInstallNudge();
	}

	later(): void {
		settings.dismissInstallNudge();
	}
}

export const install = new Install();
