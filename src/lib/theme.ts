// Light, dark, or whatever the phone uses. The page gets a concrete data-theme ("light" or "dark")
// so the stylesheet has one dark block; "system" is resolved here, and again when the phone
// switches. static/theme.js (loaded by src/app.html) applies the saved choice the same way before
// the first paint.

export type Theme = 'light' | 'dark' | 'system';

export const THEME_KEY = 'trolley.theme';

/** The address bar colour for each look: the page background. */
const THEME_COLOR = { light: '#f6f8fc', dark: '#0b0f17' };

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)');

export function readTheme(value: string | null): Theme {
	return value === 'dark' || value === 'system' ? value : 'light';
}

/** Sets the page's look now, and keeps "system" in step with the phone until called again. */
export function applyTheme(theme: Theme): () => void {
	const media = prefersDark();
	const apply = () => {
		const look = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
		document.documentElement.dataset.theme = look;
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[look]);
	};
	apply();
	if (theme !== 'system') return () => {};
	media.addEventListener('change', apply);
	return () => media.removeEventListener('change', apply);
}
