// How the app looks beyond light and dark (src/lib/theme.ts): set on <html> as data attributes
// that app.css reads. static/theme.js applies the saved choices the same way before the first
// paint.

export type Accent = 'blue' | 'purple' | 'green' | 'orange' | 'pink' | 'teal';

export const ACCENT_KEY = 'trolley.accent';

/** Each colour's accent in light and dark, as in app.css, for drawing its swatch. */
export const ACCENTS: { value: Accent; label: string; light: string; dark: string }[] = [
	{ value: 'blue', label: 'Blue', light: '#1d4ed8', dark: '#7ea4ff' },
	{ value: 'purple', label: 'Purple', light: '#6d28d9', dark: '#b69cff' },
	{ value: 'green', label: 'Green', light: '#15803d', dark: '#4ade80' },
	{ value: 'orange', label: 'Orange', light: '#c2410c', dark: '#fb923c' },
	{ value: 'pink', label: 'Pink', light: '#be185d', dark: '#f472b6' },
	{ value: 'teal', label: 'Teal', light: '#0f766e', dark: '#2dd4bf' }
];

export function readAccent(value: string | null): Accent {
	return ACCENTS.find((accent) => accent.value === value)?.value ?? 'blue';
}

export function applyAccent(accent: Accent): void {
	document.documentElement.dataset.accent = accent;
}

/** Text sizes, as a percentage of the default. */
export const TEXT_SIZES = [90, 100, 110, 120, 135] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export const TEXT_SIZE_KEY = 'trolley.textSize';

export function readTextSize(value: string | null): TextSize {
	return TEXT_SIZES.find((size) => String(size) === value) ?? 100;
}

/** Scales the root font size, and with it everything sized in rem. */
export function applyTextSize(size: TextSize): void {
	document.documentElement.style.setProperty('--text-scale', String(size / 100));
}
