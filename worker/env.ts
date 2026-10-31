/** The part of Cloudflare's Email Service binding that the Worker uses. */
export interface EmailBinding {
	send(message: {
		to: string;
		from: string;
		subject: string;
		text: string;
		html: string;
	}): Promise<{ messageId: string }>;
}

/** What the Worker is bound to, as declared in wrangler.jsonc. */
export interface Env {
	DB: D1Database;
	/** One TripRoom per open trip: tells the phones on it when it changes (worker/trips/room.ts). */
	TRIPS?: DurableObjectNamespace;
	/** Sends sign-in links. Needs the sending domain set up in Cloudflare Email Service. */
	EMAIL?: EmailBinding;
	/** Who sign-in links are sent from, e.g. "Trolay <signin@your-domain>". */
	MAIL_FROM?: string;
	/**
	 * "capture" keeps emails in memory and prints them, instead of sending, and exposes them at
	 * /api/dev/outbox. For development and the end-to-end tests only; leave it unset in production.
	 */
	MAIL_MODE?: string;
	/** The app's address in links, when it differs from where the request came in. */
	APP_ORIGIN?: string;
}
