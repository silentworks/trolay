const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** An unguessable random string: 32 bytes from the platform's secure random source. */
export function randomToken(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** SHA-256 of a string, base64url. Session tokens are stored only as this. */
export async function sha256(text: string): Promise<string> {
	return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}
