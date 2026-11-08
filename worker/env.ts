/** What the Worker is bound to, as declared in wrangler.jsonc. */
export interface Env {
	DB: D1Database;
	/** One TripRoom per open trip: tells the phones on it when it changes (worker/trips/room.ts). */
	TRIPS?: DurableObjectNamespace;
	/** Label photos of shared open trips, under trips/<trip id>/<photo id>. */
	PHOTOS?: R2Bucket;
	/** The app's address in links, when it differs from where the request came in. */
	APP_ORIGIN?: string;
	/** Sends feedback email (Cloudflare Email Service). Local `wrangler dev` keeps it, unsent. */
	EMAIL?: SendEmail;
	/** Where feedback goes: a fixed address, never one from the request. */
	FEEDBACK_TO?: string;
	/** The address feedback comes from, on a domain set up for Email Sending. */
	FEEDBACK_FROM?: string;
	/** Turnstile's secret key, a Worker secret, for checking the form's bot check. */
	TURNSTILE_SECRET_KEY?: string;
}
