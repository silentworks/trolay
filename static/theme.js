// The saved look (src/lib/theme.ts), before the first paint so it doesn't flash.
(function () {
	let theme = 'light';
	try {
		theme = localStorage.getItem('trolley.theme') || 'light';
	} catch {
		// Storage can be blocked; the default look is used.
	}
	const dark =
		theme === 'dark' ||
		(theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.dataset.theme = dark ? 'dark' : 'light';
	if (dark) document.querySelector('meta[name="theme-color"]').content = '#0b0f17';
})();
