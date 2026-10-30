import type { Env } from './env.ts';
import { error, json } from './http.ts';

type Handler = (request: Request, env: Env) => Promise<Response> | Response;

/** Every API route: path, then the methods it answers. The app and API share one origin. */
const routes: Record<string, Partial<Record<string, Handler>>> = {
	'/api/health': {
		GET: async (_request, env) => {
			await env.DB.prepare('SELECT 1').first();
			return json({ ok: true });
		}
	}
};

export async function handleApi(request: Request, env: Env): Promise<Response> {
	const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
	const route = routes[path];
	if (!route) return error(404, 'not_found');
	const handler = route[request.method];
	if (!handler) {
		return error(405, 'method_not_allowed', { Allow: Object.keys(route).join(', ') });
	}
	try {
		return await handler(request, env);
	} catch (cause) {
		console.error(cause);
		return error(500, 'server_error');
	}
}
