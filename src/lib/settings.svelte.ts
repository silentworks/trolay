import {
	ACCENT_KEY,
	readAccent,
	readTextSize,
	TEXT_SIZE_KEY,
	type Accent,
	type TextSize
} from '#lib/appearance.ts';
import { readTheme, THEME_KEY, type Theme } from '#lib/theme.ts';

// Per-device preferences. Storage can be unavailable (private browsing, blocked site data),
// so every access is guarded and the app falls back to defaults.

const INSTALL_NUDGE_KEY = 'trolley.installNudgeDismissed';
const ONBOARDED_KEY = 'trolley.onboarded';
const WHATS_NEW_KEY = 'trolley.whatsNewSeen';

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
	accent = $state<Accent>(readAccent(read(ACCENT_KEY)));
	/** A percentage of the default text size. */
	textSize = $state<TextSize>(readTextSize(read(TEXT_SIZE_KEY)));
	/** The first-run guide was finished or skipped, or this phone already had stores or trips. */
	onboarded = $state(read(ONBOARDED_KEY) === 'true');
	/** The newest changelog entry this phone has been shown (or told of), e.g. "2026.11.07". */
	whatsNewSeen = $state<string | null>(read(WHATS_NEW_KEY));

	dismissInstallNudge(): void {
		this.installNudgeDismissed = true;
		write(INSTALL_NUDGE_KEY, 'true');
	}

	setTheme(theme: Theme): void {
		this.theme = theme;
		write(THEME_KEY, theme);
	}

	setAccent(accent: Accent): void {
		this.accent = accent;
		write(ACCENT_KEY, accent);
	}

	setTextSize(size: TextSize): void {
		this.textSize = size;
		write(TEXT_SIZE_KEY, String(size));
	}

	markOnboarded(): void {
		this.onboarded = true;
		write(ONBOARDED_KEY, 'true');
	}

	/** Remembers the changelog as seen up to this entry; never goes back to an older one. */
	markWhatsNewSeen(version: string): void {
		if (this.whatsNewSeen !== null && this.whatsNewSeen >= version) return;
		this.whatsNewSeen = version;
		write(WHATS_NEW_KEY, version);
	}
}

export const settings = new Settings();
