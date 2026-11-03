/** What the Worker is bound to, as declared in wrangler.jsonc. */
export interface Env {
	DB: D1Database;
	/** One TripRoom per open trip: tells the phones on it when it changes (worker/trips/room.ts). */
	TRIPS?: DurableObjectNamespace;
	/** Label photos of shared open trips, under trips/<trip id>/<photo id>. */
	PHOTOS?: R2Bucket;
	/** The app's address in links, when it differs from where the request came in. */
	APP_ORIGIN?: string;
}
