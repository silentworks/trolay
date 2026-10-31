import { handleApi } from './api.ts';
import type { Env } from './env.ts';
import { error } from './http.ts';

export { TripRoom } from './trips/room.ts';

// The Worker answers /api/* only (`run_worker_first` in wrangler.jsonc); every other path is
// served straight from the static assets, so the app needs no Worker to load.
export default {
	fetch(request, env) {
		const { pathname } = new URL(request.url);
		return pathname === '/api' || pathname.startsWith('/api/')
			? handleApi(request, env)
			: error(404, 'not_found');
	}
} satisfies ExportedHandler<Env>;
