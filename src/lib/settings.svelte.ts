import type { TotalMode } from '#lib/money.ts';

// Per-device preferences. Storage can be unavailable (private browsing, blocked site data),
// so every access is guarded and the app falls back to defaults.

const TOTAL_MODE_KEY = 'trolley.totalMode';
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
	totalMode = $state<TotalMode>(read(TOTAL_MODE_KEY) === 'excl' ? 'excl' : 'incl');
	installNudgeDismissed = $state(read(INSTALL_NUDGE_KEY) === 'true');
	/** The first-run guide was finished or skipped, or this phone already had stores or trips. */
	onboarded = $state(read(ONBOARDED_KEY) === 'true');

	toggleTotalMode(): void {
		this.totalMode = this.totalMode === 'incl' ? 'excl' : 'incl';
		write(TOTAL_MODE_KEY, this.totalMode);
	}

	dismissInstallNudge(): void {
		this.installNudgeDismissed = true;
		write(INSTALL_NUDGE_KEY, 'true');
	}

	markOnboarded(): void {
		this.onboarded = true;
		write(ONBOARDED_KEY, 'true');
	}
}

export const settings = new Settings();
