import {
	DETAIL_LABELS,
	isTopic,
	looksLikeEmail,
	MAX_DETAIL,
	MAX_MESSAGE,
	messageLength,
	MIN_MESSAGE,
	type DetailKey,
	type Topic
} from '#lib/feedback.ts';
import { sessionUser } from './auth/session.ts';
import type { Env } from './env.ts';
import { BadRequest, error, json, readJson } from './http.ts';
import { HOUR, source, withinLimits } from './rate.ts';

/** Feedback is short text and a few details; nothing bigger is read. */
export const MAX_FEEDBACK_BODY = 16 * 1024;
export const FEEDBACK_PER_SOURCE_HOUR = 5;
export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Turnstile tokens are at most 2048 characters. */
const MAX_TOKEN = 2048;

interface Feedback {
	topic: Topic;
	message: string;
	email?: string;
	details?: [DetailKey, string][];
	token: string;
}

/** Line breaks kept, carriage returns and other control characters dropped. */
const clean = (text: string) => text.replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\n\t]/gu, '');

function parse(body: Record<string, unknown>): Feedback {
	const topic = body.topic ?? 'Something else';
	if (!isTopic(topic)) throw new BadRequest('invalid_topic');

	if (typeof body.message !== 'string') throw new BadRequest('invalid_message');
	const message = clean(body.message).trim();
	if (messageLength(message) < MIN_MESSAGE) throw new BadRequest('message_too_short');
	if (messageLength(message) > MAX_MESSAGE) throw new BadRequest('message_too_long');

	let email: string | undefined;
	if (body.email !== undefined && body.email !== '') {
		if (typeof body.email !== 'string' || !looksLikeEmail(body.email.trim())) {
			throw new BadRequest('invalid_email');
		}
		email = body.email.trim();
	}

	let details: Feedback['details'];
	if (body.details !== undefined) {
		const given = body.details;
		if (typeof given !== 'object' || given === null || Array.isArray(given)) {
			throw new BadRequest('invalid_details');
		}
		details = [];
		// Only the known details, in their own order; anything else is dropped.
		for (const key of Object.keys(DETAIL_LABELS) as DetailKey[]) {
			const value = (given as Record<string, unknown>)[key];
			if (value === undefined) continue;
			if (typeof value !== 'string' || value.length > MAX_DETAIL) {
				throw new BadRequest('invalid_details');
			}
			details.push([key, clean(value).replace(/\s+/g, ' ').trim()]);
		}
	}

	const token = body.token;
	if (typeof token !== 'string' || !token || token.length > MAX_TOKEN) {
		throw new BadRequest('turnstile_failed');
	}
	return { topic, message, email, details, token };
}

/**
 * Asks Turnstile whether the token is good: issued for our widget, not expired and not used
 * before. The sender's address goes with it, as Turnstile recommends.
 */
async function humanCheck(request: Request, secret: string, token: string): Promise<boolean> {
	const form = new FormData();
	form.append('secret', secret);
	form.append('response', token);
	const ip = request.headers.get('CF-Connecting-IP');
	if (ip) form.append('remoteip', ip);
	const reply = await fetch(SITEVERIFY, { method: 'POST', body: form });
	if (!reply.ok) throw new Error(`siteverify answered ${reply.status}`);
	const result = (await reply.json()) as { success?: boolean; 'error-codes'?: string[] };
	if (!result.success) console.warn('Turnstile refused feedback', result['error-codes']);
	return result.success === true;
}

/** The email, in plain text only: nothing the sender wrote is ever read as HTML. */
export function feedbackText(feedback: Omit<Feedback, 'token'>, userId: string | undefined) {
	const lines = [
		`Topic: ${feedback.topic}`,
		`Reply to: ${feedback.email ?? 'no address given'}`,
		`Account: ${userId ?? 'not signed in'}`,
		'',
		feedback.message
	];
	if (feedback.details?.length) {
		lines.push('', '-- About their phone', '');
		for (const [key, value] of feedback.details) lines.push(`${DETAIL_LABELS[key]}: ${value}`);
	}
	return lines.join('\n') + '\n';
}

/**
 * POST /api/feedback: a message from the form in Settings, emailed to the address in
 * configuration (FEEDBACK_TO), never one from the request. Nothing is stored: the email is the
 * record. Bots are kept out by Turnstile, and each source may send a few an hour.
 */
export async function sendFeedback(request: Request, env: Env): Promise<Response> {
	const feedback = parse(await readJson(request, MAX_FEEDBACK_BODY));
	const { EMAIL, FEEDBACK_TO, FEEDBACK_FROM, TURNSTILE_SECRET_KEY } = env;
	if (!EMAIL || !FEEDBACK_TO || !FEEDBACK_FROM || !TURNSTILE_SECRET_KEY) {
		console.error(
			'Feedback is not configured: it needs EMAIL, FEEDBACK_TO, FEEDBACK_FROM and TURNSTILE_SECRET_KEY'
		);
		return error(503, 'not_configured');
	}

	const allowed = await withinLimits(env, [
		{ key: `feedback:${await source(request)}`, max: FEEDBACK_PER_SOURCE_HOUR, window: HOUR }
	]);
	if (!allowed) return error(429, 'too_many_requests');

	let human: boolean;
	try {
		human = await humanCheck(request, TURNSTILE_SECRET_KEY, feedback.token);
	} catch (cause) {
		console.error('Turnstile could not be asked', cause);
		return error(503, 'turnstile_unavailable');
	}
	if (!human) return error(400, 'turnstile_failed');

	const userId = await sessionUser(request, env);
	try {
		await EMAIL.send({
			to: FEEDBACK_TO,
			from: { email: FEEDBACK_FROM, name: 'Trolay feedback' },
			...(feedback.email ? { replyTo: feedback.email } : {}),
			subject: `Trolay feedback: ${feedback.topic}`,
			text: feedbackText(feedback, userId)
		});
	} catch (cause) {
		console.error('Feedback email was not sent', cause);
		return error(502, 'send_failed');
	}
	return json({ ok: true });
}
