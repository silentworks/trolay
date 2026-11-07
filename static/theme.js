// The saved look (src/lib/theme.ts, src/lib/appearance.ts), before the first paint so it doesn't
// flash.
(function () {
	const saved = (key) => {
		try {
			return localStorage.getItem(key);
		} catch {
			// Storage can be blocked; the default look is used.
			return null;
		}
	};
	const root = document.documentElement;
	const theme = saved('trolley.theme') || 'light';
	const dark =
		theme === 'dark' ||
		(theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
	root.dataset.theme = dark ? 'dark' : 'light';
	if (dark) document.querySelector('meta[name="theme-color"]').content = '#0b0f17';
	const accent = saved('trolley.accent');
	if (/^(blue|purple|green|orange|pink|teal)$/.test(accent || '')) root.dataset.accent = accent;
	// Animations off, or not chosen and the phone asking for less motion.
	const animations = saved('trolley.animations');
	const still =
		animations === 'off' ||
		(animations !== 'on' && matchMedia('(prefers-reduced-motion: reduce)').matches);
	root.dataset.motion = still ? 'reduce' : 'full';
	const density = saved('trolley.density');
	if (/^(compact|spacious)$/.test(density || '')) root.dataset.density = density;
	const textSize = saved('trolley.textSize');
	if (/^(90|110|120|135)$/.test(textSize || '')) {
		root.style.setProperty('--text-scale', String(Number(textSize) / 100));
	}
})();
