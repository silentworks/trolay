import type { CDPSession, Page } from '@playwright/test';

export interface VirtualPasskeys {
	client: CDPSession;
	authenticatorId: string;
}

/**
 * A virtual authenticator stands in for the phone's passkey store (Chromium only). By default it
 * verifies the user, as a phone with a fingerprint or PIN does; `verifiesUser: false` is one that
 * never does (some password managers and security keys).
 */
export async function withPasskeys(
	page: Page,
	{ verifiesUser = true }: { verifiesUser?: boolean } = {}
): Promise<VirtualPasskeys> {
	const client = await page.context().newCDPSession(page);
	await client.send('WebAuthn.enable');
	const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: verifiesUser,
			isUserVerified: verifiesUser,
			automaticPresenceSimulation: true
		}
	});
	return { client, authenticatorId };
}

/** Gives another browser the same passkeys, as iCloud Keychain or Google Password Manager would. */
export async function copyPasskeys(from: VirtualPasskeys, to: VirtualPasskeys): Promise<void> {
	const { credentials } = await from.client.send('WebAuthn.getCredentials', {
		authenticatorId: from.authenticatorId
	});
	for (const credential of credentials) {
		await to.client.send('WebAuthn.addCredential', {
			authenticatorId: to.authenticatorId,
			credential
		});
	}
}
