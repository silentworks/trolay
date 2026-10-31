import { defineConfig, devices } from '@playwright/test';
import { FAKE_CAMERA_VIDEO } from './e2e/global-setup';

export default defineConfig({
	testDir: 'e2e',
	// Several tests run two or three phones against one local API with one SQLite database; with
	// more than three tests at once that API falls behind and sign-ups time out now and then.
	workers: 3,
	globalSetup: './e2e/global-setup.ts',
	webServer: [
		{
			// vite proxies /api to the API below, as in production where they share an origin.
			command: 'pnpm build && pnpm preview --port 4173 --strictPort',
			port: 4173,
			env: { API_PORT: '8788' },
			reuseExistingServer: !process.env.CI
		},
		{
			// Its own port and a database that starts empty each run.
			command: 'node scripts/dev-api.js',
			url: 'http://localhost:8788/api/health',
			env: { API_PORT: '8788', API_PERSIST: '.wrangler/e2e', API_FRESH: '1' },
			reuseExistingServer: !process.env.CI
		}
	],
	use: {
		baseURL: 'http://localhost:4173',
		...devices['Pixel 7']
	},
	projects: [
		{ name: 'app', testIgnore: /camera\.test\.ts/ },
		{
			// Chromium's fake camera plays a shelf-label fixture (made by global-setup.ts).
			name: 'camera',
			testMatch: /camera\.test\.ts/,
			use: {
				permissions: ['camera'],
				launchOptions: {
					args: [
						'--use-fake-ui-for-media-stream',
						'--use-fake-device-for-media-stream',
						`--use-file-for-fake-video-capture=${FAKE_CAMERA_VIDEO}`
					]
				}
			}
		}
	]
});
