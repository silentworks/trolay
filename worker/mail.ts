import type { Env } from './env.ts';

export interface Mail {
	to: string;
	subject: string;
	text: string;
	html: string;
}

// Emails captured when MAIL_MODE is "capture", newest last. Lives only in this Worker instance.
const outbox: Mail[] = [];

export function capturedMail(to?: string): Mail[] {
	return to ? outbox.filter((mail) => mail.to === to) : [...outbox];
}

export async function sendMail(env: Env, mail: Mail): Promise<void> {
	if (env.MAIL_MODE === 'capture') {
		outbox.push(mail);
		if (outbox.length > 50) outbox.shift();
		console.log(`[mail] to ${mail.to}: ${mail.subject}\n${mail.text}`);
		return;
	}
	if (!env.EMAIL || !env.MAIL_FROM) throw new Error('Email is not set up for this Worker.');
	await env.EMAIL.send({ from: env.MAIL_FROM, ...mail });
}
