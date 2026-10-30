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
