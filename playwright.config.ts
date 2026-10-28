import { defineConfig, devices } from '@playwright/test';
import { FAKE_CAMERA_VIDEO } from './e2e/global-setup';

export default defineConfig({
	testDir: 'e2e',
	globalSetup: './e2e/global-setup.ts',
	webServer: {
		command: 'pnpm build && pnpm preview --port 4173 --strictPort',
		port: 4173,
		reuseExistingServer: !process.env.CI
	},
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
