import { describe, expect, it } from 'vitest';
import { PRODUCTION_HOST, siteKey } from './turnstile.ts';

describe('the Turnstile site key', () => {
	it('is the real widget on the app’s domain only', () => {
		expect(siteKey(PRODUCTION_HOST)).toMatch(/^0x4/);
		// Development, the tests and branch previews get the test key, which always passes.
		for (const host of ['localhost', 'sil-326-send-feedback.shopping.trolay.com']) {
			expect(siteKey(host)).toBe('1x00000000000000000000AA');
		}
	});
});
