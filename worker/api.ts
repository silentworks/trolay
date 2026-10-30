import {
	logout,
	loginOptions,
	loginVerify,
	me,
	registrationOptions,
	registrationVerify
} from './auth/passkeys.ts';
import { linkRequest, linkVerify } from './auth/link.ts';
import type { Env } from './env.ts';
import { BadRequest, error, json } from './http.ts';
import { capturedMail } from './mail.ts';
import { pull } from './sync/pull.ts';
import { push } from './sync/push.ts';

type Handler = (request: Request, env: Env) => Promise<Response> | Response;

/** Every API route: path, then the methods it answers. The app and API share one origin. */
const routes: Record<string, Partial<Record<string, Handler>>> = {
	'/api/health': {
		GET: async (_request, env) => {
			await env.DB.prepare('SELECT 1').first();
			return json({ ok: true });
		}
	},
	'/api/auth/me': { GET: me },
	'/api/auth/register/options': { POST: registrationOptions },
	'/api/auth/register/verify': { POST: registrationVerify },
	'/api/auth/login/options': { POST: loginOptions },
	'/api/auth/login/verify': { POST: loginVerify },
	'/api/auth/link/request': { POST: linkRequest },
	'/api/auth/link/verify': { POST: linkVerify },
	'/api/auth/logout': { POST: logout },
	'/api/sync/push': { POST: push },
	'/api/sync/pull': { GET: pull },
	// Emails kept instead of sent, so tests can read the link. Only exists in "capture" mode.
	'/api/dev/outbox': {
		GET: (request, env) =>
			env.MAIL_MODE === 'capture'
				? json({ mail: capturedMail(new URL(request.url).searchParams.get('to') ?? undefined) })
				: error(404, 'not_found')
	}
};

/**
 * A request that changes anything must come from this site. Cookies are SameSite=Lax and bodies
 * must be JSON, which a cross-site form cannot send; this checks the Origin header as well.
 */
function crossSite(request: Request): boolean {
	if (request.method === 'GET' || request.method === 'HEAD') return false;
	const origin = request.headers.get('Origin');
	return origin !== null && origin !== new URL(request.url).origin;
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
	const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
	const route = routes[path];
	if (!route) return error(404, 'not_found');
	const handler = route[request.method];
	if (!handler) {
		return error(405, 'method_not_allowed', { Allow: Object.keys(route).join(', ') });
	}
	if (crossSite(request)) return error(403, 'cross_site');
	try {
		return await handler(request, env);
	} catch (cause) {
		if (cause instanceof BadRequest) return error(400, cause.message);
		console.error(cause);
		return error(500, 'server_error');
	}
}
