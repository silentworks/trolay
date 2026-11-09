// Cloudflare Turnstile, which keeps bots off the feedback form. Its script is loaded only when the
// form opens, from the one address Turnstile supports (allowed by the page's
// Content-Security-Policy in vite.config.ts); the challenge runs in its own frame.

/** The production widget ("Trolay feedback"), allowed on the app's domain. Public by design. */
const PRODUCTION_KEY = '0x4AAAAAAF6Xkj4VbsG8335V';
export const PRODUCTION_HOST = 'shopping.trolay.com';
/**
 * Turnstile's test key: its every token passes Turnstile's test secret, which local development
 * and the end-to-end tests run with (scripts/dev-api.js), and fails the real one. Branch previews
 * use it too, and have no email set up, so they never send.
 */
const TEST_KEY = '1x00000000000000000000AA';

/** The real widget on the app's own domain; the test widget everywhere else. */
export function siteKey(hostname: string): string {
	return (
		import.meta.env.VITE_TURNSTILE_SITE_KEY ||
		(hostname === PRODUCTION_HOST ? PRODUCTION_KEY : TEST_KEY)
	);
}

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
