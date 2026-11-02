import { readTheme, THEME_KEY, type Theme } from '#lib/theme.ts';

// Per-device preferences. Storage can be unavailable (private browsing, blocked site data),
// so every access is guarded and the app falls back to defaults.

const INSTALL_NUDGE_KEY = 'trolley.installNudgeDismissed';
const ONBOARDED_KEY = 'trolley.onboarded';

function read(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		// Not persisted; the in-memory value still applies for this session.
	}
}

class Settings {
	installNudgeDismissed = $state(read(INSTALL_NUDGE_KEY) === 'true');
	/** Light unless the shopper chose dark, or to match the phone. */
	theme = $state<Theme>(readTheme(read(THEME_KEY)));
	/** The first-run guide was finished or skipped, or this phone already had stores or trips. */
	onboarded = $state(read(ONBOARDED_KEY) === 'true');

	dismissInstallNudge(): void {
		this.installNudgeDismissed = true;
		write(INSTALL_NUDGE_KEY, 'true');
	}

	setTheme(theme: Theme): void {
		this.theme = theme;
		write(THEME_KEY, theme);
	}

	markOnboarded(): void {
		this.onboarded = true;
		write(ONBOARDED_KEY, 'true');
	}
}

export const settings = new Settings();
