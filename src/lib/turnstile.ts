// Cloudflare Turnstile, which keeps bots off the feedback form. Its script is loaded only when the
// form opens, from the one address Turnstile supports (allowed by the page's
// Content-Security-Policy in vite.config.ts); the challenge runs in its own frame.

/**
 * The widget's site key, public by design. Without one set at build time this is Turnstile's
 * test key, whose every token passes Turnstile's test secret (used by local development and the
 * end-to-end tests) and fails a real one, so a build that forgot it sends nothing.
 */
export const SITE_KEY: string =
	import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileOptions {
	sitekey: string;
	theme?: 'light' | 'dark' | 'auto';
	size?: 'normal' | 'flexible' | 'compact';
	language?: string;
	callback?: (token: string) => void;
	'expired-callback'?: () => void;
	'error-callback'?: (code: string) => void;
	'timeout-callback'?: () => void;
}

export interface Turnstile {
	render(container: HTMLElement, options: TurnstileOptions): string;
	reset(widgetId: string): void;
	remove(widgetId: string): void;
}

let loading: Promise<Turnstile> | undefined;

/** Turnstile, loaded once. A failed load is forgotten, so opening the form again retries. */
export function loadTurnstile(): Promise<Turnstile> {
	const ready = (window as Window & { turnstile?: Turnstile }).turnstile;
	if (ready) return Promise.resolve(ready);
	loading ??= new Promise<Turnstile>((resolve, reject) => {
		const script = document.createElement('script');
		script.src = SCRIPT;
		script.async = true;
		script.onload = () => {
			const turnstile = (window as Window & { turnstile?: Turnstile }).turnstile;
			if (turnstile) resolve(turnstile);
			else reject(new Error('Turnstile did not start'));
		};
		script.onerror = () => {
			script.remove();
			reject(new Error('Turnstile did not load'));
		};
		document.head.append(script);
	}).catch((cause) => {
		loading = undefined;
		throw cause;
	});
	return loading;
}
