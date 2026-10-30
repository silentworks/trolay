/** A JSON response. API answers are per person and are never cached. */
export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }
	});
}

export function error(status: number, code: string, headers: HeadersInit = {}): Response {
	return json({ error: code }, status, headers);
}

/** The largest request body the API reads by default. Most of what it takes is tiny JSON. */
const MAX_BODY = 64 * 1024;

export class BadRequest extends Error {}

/** A JSON object body; anything else is a 400. */
export async function readJson(
	request: Request,
	maxBytes = MAX_BODY
): Promise<Record<string, unknown>> {
	if (!request.headers.get('Content-Type')?.startsWith('application/json')) {
		throw new BadRequest('expected_json');
	}
	const text = await request.text();
	if (text.length > maxBytes) throw new BadRequest('too_large');
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		throw new BadRequest('invalid_json');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		throw new BadRequest('expected_object');
	}
	return body as Record<string, unknown>;
}
