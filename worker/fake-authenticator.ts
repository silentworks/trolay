import type {
	AuthenticationResponseJSON,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/server';
import { base64url } from './auth/tokens.ts';

// A software WebAuthn authenticator for tests: a real P-256 key that makes real "none"
// attestations and real signatures, so the server's checks run on genuine data. It can also be
// told to lie (a wrong origin, a tampered signature) to prove those are refused.

const encoder = new TextEncoder();
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((part) => [...part]));
const sha256 = async (bytes: Uint8Array) =>
	new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const u32 = (n: number) => new Uint8Array([n >>> 24, n >>> 16, n >>> 8, n].map((v) => v & 255));

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
	const binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// The few CBOR shapes a COSE key and an attestation object need.
function head(major: number, length: number): Uint8Array {
	if (length < 24) return new Uint8Array([(major << 5) | length]);
	if (length < 256) return new Uint8Array([(major << 5) | 24, length]);
	return new Uint8Array([(major << 5) | 25, length >> 8, length & 255]);
}
const cborInt = (n: number) => (n >= 0 ? head(0, n) : head(1, -1 - n));
const cborBytes = (bytes: Uint8Array) => concat(head(2, bytes.length), bytes);
const cborText = (text: string) => concat(head(3, text.length), encoder.encode(text));
const cborMap = (...pairs: [Uint8Array, Uint8Array][]) =>
	concat(head(5, pairs.length), ...pairs.flat());

/** WebCrypto gives an ECDSA signature as r||s; WebAuthn wants it as DER. */
function derSignature(raw: Uint8Array): Uint8Array {
	const integer = (bytes: Uint8Array) => {
		let start = 0;
		while (start < bytes.length - 1 && bytes[start] === 0) start++;
		const body = bytes.slice(start);
		return concat(
			new Uint8Array([2, body.length + (body[0] & 0x80 ? 1 : 0)]),
			body[0] & 0x80 ? new Uint8Array([0]) : new Uint8Array(),
			body
		);
	};
	const sequence = concat(integer(raw.slice(0, 32)), integer(raw.slice(32)));
	return concat(new Uint8Array([0x30, sequence.length]), sequence);
}

export interface Lies {
	/** The origin the "browser" claims the ceremony happened on. */
	origin?: string;
	/** Flip a bit of the signature. */
	tamper?: boolean;
}

export class FakeAuthenticator {
	counter = 0;
	credentialId = crypto.getRandomValues(new Uint8Array(16));
	private keys?: CryptoKeyPair;

	constructor(
		private readonly rpID: string,
		private readonly origin: string
	) {}

	get id(): string {
		return base64url(this.credentialId);
	}

	private async key(): Promise<CryptoKeyPair> {
		this.keys ??= (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
			'sign'
		])) as CryptoKeyPair;
		return this.keys;
	}

	private async clientData(type: string, challenge: string, lies: Lies) {
		return encoder.encode(
			JSON.stringify({ type, challenge, origin: lies.origin ?? this.origin, crossOrigin: false })
		);
	}

	async create(
		options: PublicKeyCredentialCreationOptionsJSON,
		lies: Lies = {}
	): Promise<RegistrationResponseJSON> {
		const jwk = (await crypto.subtle.exportKey('jwk', (await this.key()).publicKey)) as JsonWebKey;
		const coseKey = cborMap(
			[cborInt(1), cborInt(2)],
			[cborInt(3), cborInt(-7)],
			[cborInt(-1), cborInt(1)],
			[cborInt(-2), cborBytes(fromBase64url(jwk.x!))],
			[cborInt(-3), cborBytes(fromBase64url(jwk.y!))]
		);
		const authData = concat(
			await sha256(encoder.encode(this.rpID)),
			new Uint8Array([0x45]), // user present, user verified, attested credential data
			u32(this.counter),
			new Uint8Array(16), // AAGUID
			new Uint8Array([0, this.credentialId.length]),
			this.credentialId,
			coseKey
		);
		const attestationObject = cborMap(
			[cborText('fmt'), cborText('none')],
			[cborText('attStmt'), cborMap()],
			[cborText('authData'), cborBytes(authData)]
		);
		return {
			id: this.id,
			rawId: this.id,
			type: 'public-key',
			clientExtensionResults: {},
			response: {
				clientDataJSON: base64url(
					await this.clientData('webauthn.create', options.challenge, lies)
				),
				attestationObject: base64url(attestationObject),
				transports: ['internal']
			}
		};
	}

	async get(
		options: PublicKeyCredentialRequestOptionsJSON,
		lies: Lies = {}
	): Promise<AuthenticationResponseJSON> {
		this.counter += 1;
		const clientData = await this.clientData('webauthn.get', options.challenge, lies);
		const authData = concat(
			await sha256(encoder.encode(this.rpID)),
			new Uint8Array([0x05]), // user present, user verified
			u32(this.counter)
		);
		const signed = concat(authData, await sha256(new Uint8Array(clientData)));
		const raw = new Uint8Array(
			await crypto.subtle.sign(
				{ name: 'ECDSA', hash: 'SHA-256' },
				(await this.key()).privateKey,
				new Uint8Array(signed)
			)
		);
		if (lies.tamper) raw[10] ^= 1;
		return {
			id: this.id,
			rawId: this.id,
			type: 'public-key',
			clientExtensionResults: {},
			response: {
				clientDataJSON: base64url(clientData),
				authenticatorData: base64url(authData),
				signature: base64url(derSignature(raw))
			}
		};
	}
}
