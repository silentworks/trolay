import { startAuthentication, startRegistration } from '@simplewebauthn/browser';

// Signing in is optional: the app is complete without an account. An account only adds sync
// between your own devices, and this module is the only part of the app that talks to /api/auth.

export type AccountStatus = 'unknown' | 'signedOut' | 'signedIn';

const MESSAGES: Record<string, string> = {
	verification_failed: 'That passkey was not accepted. Try again.',
	challenge_expired: 'That took too long. Try again.',
	already_registered: 'This passkey is already registered.',
	wrong_account: 'That passkey belongs to a different account.',
	invalid_email: "That doesn't look like an email address.",
	too_many_requests: 'Too many requests. Wait a minute and try again.',
	email_failed: 'The email could not be sent. Try again later.',
	link_invalid: 'That link has expired or was already used. Ask for a new one.',
	email_in_use: 'That email belongs to a different account.'
};

/** What opening an emailed link did. */
export type LinkResult =
	{ kind: 'signedIn'; hasPasskey: boolean } | { kind: 'added'; email: string };

function explain(cause: unknown): string {
	if (cause instanceof DOMException || (cause instanceof Error && cause.name in WEBAUTHN_NAMES)) {
		return WEBAUTHN_NAMES[cause.name] ?? 'The passkey could not be used.';
	}
	if (cause instanceof TypeError) return 'You need a connection to do that.';
	if (cause instanceof ApiError) return MESSAGES[cause.code] ?? 'Something went wrong. Try again.';
	return 'Something went wrong. Try again.';
}

const WEBAUTHN_NAMES: Record<string, string> = {
	NotAllowedError: 'Cancelled, or it took too long. Try again.',
	InvalidStateError: 'This device already has a passkey for this account.',
	NotSupportedError: 'This device cannot make passkeys.',
	SecurityError: 'Passkeys only work on the real site, over HTTPS.'
};

class ApiError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}

async function api<T>(path: string, body?: unknown): Promise<T> {
	const response = await fetch(path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	// Where there is no API (a static preview) the app's own page comes back instead of JSON.
	const data = await response.json();
	if (!response.ok) throw new ApiError(data?.error ?? 'error');
	return data as T;
}

interface Ceremony {
	challengeId: string;
	options: Parameters<typeof startRegistration>[0]['optionsJSON'];
}

// Whether this phone has been signed in, kept only so the app does not ask the server about an
// account on a phone that never made one.
const REMEMBER = 'trolay-account';
function remember(signedIn: boolean) {
	try {
		if (signedIn) localStorage.setItem(REMEMBER, '1');
		else localStorage.removeItem(REMEMBER);
	} catch {
		// Storage can be blocked; the account still works, it is just asked about each visit.
	}
}
function remembered(): boolean {
	try {
		return localStorage.getItem(REMEMBER) === '1';
	} catch {
		return false;
	}
}

class Account {
	status = $state<AccountStatus>('unknown');
	/** Who is signed in, when known. */
	userId = $state<string>();
	/**
	 * This phone was signed in last time but the server could not be asked this time (no signal),
	 * so the app can still show what is waiting to sync.
	 */
	maybeSignedIn = $state(false);
	busy = $state(false);
	error = $state<string>();
	/** The address a sign-in link was last sent to. */
	linkSentTo = $state<string>();

	/** Asks the server who is signed in. Offline, or with no API, the status stays unknown. */
	async refresh(): Promise<void> {
		try {
			const { user } = await api<{ user: { id: string } | null }>('/api/auth/me');
			this.setSignedIn(user?.id);
		} catch {
			// Nothing to say: the app works the same without an account.
		}
	}

	/** At the start of the app: checks the session, but only on a phone that has signed in. */
	restore(): Promise<void> {
		if (!remembered()) return Promise.resolve();
		this.maybeSignedIn = true;
		return this.refresh();
	}

	private setSignedIn(userId: string | undefined): void {
		this.userId = userId;
		this.maybeSignedIn = userId !== undefined;
		this.status = userId ? 'signedIn' : 'signedOut';
		remember(userId !== undefined);
	}

	/** The server turned a request down because nobody is signed in any more. */
	sessionEnded(): void {
		this.setSignedIn(undefined);
	}

	private async attempt(action: () => Promise<void>): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.error = undefined;
		try {
			await action();
		} catch (cause) {
			this.error = explain(cause);
		} finally {
			this.busy = false;
		}
	}

	/** Makes an account (or, signed in, adds a passkey to it) with a passkey on this device. */
	register(): Promise<void> {
		return this.attempt(async () => {
			const { challengeId, options } = await api<Ceremony>('/api/auth/register/options', {});
			const credential = await startRegistration({ optionsJSON: options });
			const { user } = await api<{ user: { id: string } }>('/api/auth/register/verify', {
				challengeId,
				credential
			});
			this.setSignedIn(user.id);
		});
	}

	signIn(): Promise<void> {
		return this.attempt(async () => {
			const { challengeId, options } = await api<{
				challengeId: string;
				options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
			}>('/api/auth/login/options', {});
			const credential = await startAuthentication({ optionsJSON: options });
			const { user } = await api<{ user: { id: string } }>('/api/auth/login/verify', {
				challengeId,
				credential
			});
			this.setSignedIn(user.id);
		});
	}

	/** Emails a sign-in link; signed in, the link adds the address to this account instead. */
	requestLink(email: string): Promise<void> {
		return this.attempt(async () => {
			await api('/api/auth/link/request', { email });
			this.linkSentTo = email.trim();
		});
	}

	/** Uses the token from an emailed link. Resolves to what it did, or undefined on failure. */
	async completeLink(token: string): Promise<LinkResult | undefined> {
		let result: LinkResult | undefined;
		await this.attempt(async () => {
			const reply = await api<{
				user?: { id: string };
				hasPasskey?: boolean;
				added?: boolean;
				email?: string;
			}>('/api/auth/link/verify', { token });
			if (reply.added) {
				result = { kind: 'added', email: reply.email ?? '' };
			} else {
				this.setSignedIn(reply.user?.id);
				result = { kind: 'signedIn', hasPasskey: reply.hasPasskey === true };
			}
		});
		return result;
	}

	signOut(): Promise<void> {
		return this.attempt(async () => {
			await api('/api/auth/logout', {});
			this.setSignedIn(undefined);
		});
	}
}

export const account = new Account();
