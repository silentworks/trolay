// Per-device preferences. Storage can be unavailable (private browsing, blocked site data),
// so every access is guarded and the app falls back to defaults.

const TOTALS_OPEN_KEY = 'trolley.totalsOpen';
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
	/** The total card's breakdown is unfolded. */
	totalsOpen = $state(read(TOTALS_OPEN_KEY) === 'true');
	installNudgeDismissed = $state(read(INSTALL_NUDGE_KEY) === 'true');
	/** The first-run guide was finished or skipped, or this phone already had stores or trips. */
	onboarded = $state(read(ONBOARDED_KEY) === 'true');

	toggleTotals(): void {
		this.totalsOpen = !this.totalsOpen;
		write(TOTALS_OPEN_KEY, String(this.totalsOpen));
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
