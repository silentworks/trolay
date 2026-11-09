<script lang="ts">
	import { goto } from '$app/navigation';
	import { version } from '$app/env';
	import { resolve } from '$app/paths';
	import { account } from '#lib/auth/account.svelte.ts';
	import { shortVersion } from '#lib/changelog.ts';
	import AppHeader from '#lib/components/AppHeader.svelte';
	import {
		COUNT_FROM,
		DETAIL_LABELS,
		isTopic,
		looksLikeEmail,
		MAX_MESSAGE,
		messageLength,
		MIN_MESSAGE,
		TOPICS,
		type DetailKey,
		type Details,
		type Topic
	} from '#lib/feedback.ts';
	import { install } from '#lib/install.svelte.ts';
	import { settings } from '#lib/settings.svelte.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { loadTurnstile, siteKey, type Turnstile } from '#lib/turnstile.ts';

	const uid = $props.id();

	// What's typed is kept on this phone until it's sent, so a reload or a failed send loses
	// nothing.
	const DRAFT_KEY = 'trolley.feedback';
	interface Draft {
		topic: Topic;
		message: string;
		email: string;
		includeDetails: boolean;
	}
	function readDraft(): Partial<Draft> {
		try {
			const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? '{}');
			return typeof saved === 'object' && saved !== null ? saved : {};
		} catch {
			return {};
		}
	}
	const draft = readDraft();

	let topic = $state<Topic>(isTopic(draft.topic) ? draft.topic : 'Something else');
	let message = $state(typeof draft.message === 'string' ? draft.message : '');
	let email = $state(typeof draft.email === 'string' ? draft.email : '');
	let includeDetails = $state(draft.includeDetails !== false);

	$effect(() => {
		const value: Draft = { topic, message, email, includeDetails };
		try {
			if (message || email) localStorage.setItem(DRAFT_KEY, JSON.stringify(value));
			else localStorage.removeItem(DRAFT_KEY);
		} catch {
			// No storage (a private window): the draft just isn't kept.
		}
	});

	let online = $state(typeof navigator === 'undefined' || navigator.onLine);
	$effect(() => {
		const update = () => (online = navigator.onLine);
		window.addEventListener('online', update);
		window.addEventListener('offline', update);
		return () => {
			window.removeEventListener('online', update);
			window.removeEventListener('offline', update);
		};
	});

	// Checked when Send is pressed, then as the shopper fixes them.
	let tried = $state(false);
	const length = $derived(messageLength(message));
	const messageProblem = $derived(
		length < MIN_MESSAGE
			? `Write at least ${MIN_MESSAGE} characters.`
			: length > MAX_MESSAGE
				? `Keep it to ${MAX_MESSAGE.toLocaleString()} characters.`
				: undefined
	);
	const emailProblem = $derived(
		email.trim() && !looksLikeEmail(email.trim())
			? 'That doesn’t look like an email address.'
			: undefined
	);

	const LOOKS = { light: 'Light', dark: 'Dark', system: 'System' } as const;
	const short = shortVersion(version);
	let viewport = $state({ width: 0, height: 0 });
	$effect(() => {
		const measure = () => (viewport = { width: innerWidth, height: innerHeight });
		measure();
		window.addEventListener('resize', measure);
		return () => window.removeEventListener('resize', measure);
	});
	/** Exactly what goes with the message when details are included. */
	const details = $derived.by<Details>(() => {
		const look = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
		return {
			version: short === version ? version : `${short} (${version})`,
			userAgent: navigator.userAgent,
			screen: `${screen.width}×${screen.height}, window ${viewport.width}×${viewport.height}, ${devicePixelRatio}× pixels`,
			theme: settings.theme === 'system' ? `System (${look})` : LOOKS[settings.theme],
			installed: install.installed ? 'Yes' : 'No',
			signedIn: account.status === 'signedIn' ? 'Yes' : 'No'
		};
	});

	// The bot check. Send waits for its token; each token is good for one send.
	let widget = $state<HTMLElement>();
	let token = $state<string>();
	let checkFailed = $state(false);
	let turnstile: Turnstile | undefined;
	let widgetId: string | undefined;
	$effect(() => {
		const container = widget;
		if (!container || !online) return;
		// Drawn again if the theme changes, to match.
		const theme = settings.theme === 'system' ? 'auto' : settings.theme;
		let gone = false;
		checkFailed = false;
		loadTurnstile().then(
			(loaded) => {
				if (gone) return;
				turnstile = loaded;
				widgetId = loaded.render(container, {
					sitekey: siteKey(location.hostname),
					theme,
					size: 'flexible',
					callback: (value) => {
						token = value;
						checkFailed = false;
					},
					'expired-callback': () => (token = undefined),
					'timeout-callback': () => (token = undefined),
					'error-callback': () => {
						token = undefined;
						checkFailed = true;
					}
				});
			},
			() => !gone && (checkFailed = true)
		);
		return () => {
			gone = true;
			token = undefined;
			if (widgetId) turnstile?.remove(widgetId);
			widgetId = undefined;
		};
	});

	/** A token is spent once sent, whether the send worked or not: ask for a new one. */
	function newCheck() {
		token = undefined;
		if (widgetId) turnstile?.reset(widgetId);
	}

	const REFUSALS: Record<string, string> = {
		turnstile_failed: 'The check that you’re not a bot didn’t go through. Try again.',
		too_many_requests: 'You’ve sent a lot of feedback this hour. Try again later.',
		invalid_email: 'That doesn’t look like an email address.'
	};

	let sending = $state(false);
	let failure = $state<string>();

	async function send(event: SubmitEvent) {
		event.preventDefault();
		tried = true;
		if (messageProblem || emailProblem || !token || sending) return;
		sending = true;
		failure = undefined;
		try {
			const response = await fetch('/api/feedback', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					topic,
					message: message.trim(),
					email: email.trim() || undefined,
					details: includeDetails ? details : undefined,
					token
				})
			});
			if (!response.ok) {
				const code = await response
					.json()
					.then((body) => body?.error)
					.catch(() => undefined);
				failure = REFUSALS[code] ?? 'Your feedback couldn’t be sent just now. Try again later.';
				return;
			}
			message = '';
			email = '';
			topic = 'Something else';
			toast.show({ message: 'Thanks, your feedback was sent', tone: 'success' });
			await goto(resolve('/settings'));
		} catch {
			failure = 'You need a connection to send feedback.';
		} finally {
			sending = false;
			newCheck();
		}
	}
</script>

<svelte:head>
	<title>Send feedback · Trolay</title>
</svelte:head>

<div class="page">
	<AppHeader title="Send feedback" back={{ href: resolve('/settings'), label: 'Settings' }} />

	<p class="intro">Tell us what you think: an idea, a problem, anything. We read every message.</p>

	<form onsubmit={send} novalidate>
		<div class="form-rows">
			<div class="form-row form-row-wide">
				<span id="{uid}-topic">What’s it about?</span>
				<div class="segmented" role="radiogroup" aria-labelledby="{uid}-topic">
					{#each TOPICS as value (value)}
						<label>
							<input type="radio" name="topic" {value} bind:group={topic} />
							{value}
						</label>
					{/each}
				</div>
			</div>

			<div class="form-row form-row-wide">
				<label for="{uid}-message">Message</label>
				<textarea
					id="{uid}-message"
					class="input"
					rows="6"
					maxlength={MAX_MESSAGE}
					bind:value={message}
					aria-invalid={tried && !!messageProblem}
					aria-describedby="{uid}-message-note"></textarea>
				{#if tried && messageProblem}
					<p class="problem" id="{uid}-message-note">{messageProblem}</p>
				{:else if length >= COUNT_FROM}
					<p class="count" id="{uid}-message-note">
						{(MAX_MESSAGE - length).toLocaleString()} characters left
					</p>
				{/if}
			</div>

			<div class="form-row">
				<label for="{uid}-email">Your email <span class="visually-hidden">(optional)</span></label>
				<input
					id="{uid}-email"
					class="input form-value"
					type="email"
					autocomplete="email"
					inputmode="email"
					placeholder="Optional"
					bind:value={email}
					aria-invalid={tried && !!emailProblem}
					aria-describedby="{uid}-email-hint"
				/>
				{#if tried && emailProblem}
					<p class="problem" id="{uid}-email-hint">{emailProblem}</p>
				{:else}
					<p class="hint" id="{uid}-email-hint">
						Only if you’d like a reply. It’s used to answer this message and nothing else.
					</p>
				{/if}
			</div>

			<div class="form-row">
				<span aria-hidden="true">Phone details</span>
				<button
					class="toggle-pill"
					type="button"
					role="switch"
					aria-checked={includeDetails}
					aria-label="Include details about my phone"
					onclick={() => (includeDetails = !includeDetails)}
				>
					{includeDetails ? 'Included' : 'Left out'}
				</button>
			</div>
		</div>

		<details class="sent">
			<summary>What’s sent</summary>
			{#if includeDetails}
				<dl>
					{#each Object.entries(DETAIL_LABELS) as [key, label] (key)}
						<div>
							<dt>{label}</dt>
							<dd>{details[key as DetailKey]}</dd>
						</div>
					{/each}
				</dl>
			{:else}
				<p>No details about your phone.</p>
			{/if}
			<p>
				{#if account.status === 'signedIn'}
					Your account id goes too, because you’re signed in, so we can look into sync problems.
				{/if}
				Your trips, items and stores are never sent.
			</p>
		</details>

		{#if !online}
			<p class="offline" role="status">Sending feedback needs a connection.</p>
		{:else}
			<div class="widget" bind:this={widget}></div>
			{#if checkFailed}
				<p class="hint" role="status">
					The check that you’re not a bot couldn’t load. Check your connection, or try again later.
				</p>
			{/if}
		{/if}

		{#if failure}
			<p class="error" role="alert">{failure}</p>
		{/if}

		<button class="btn btn-primary btn-block" type="submit" disabled={!online || !token || sending}>
			{sending ? 'Sending…' : 'Send'}
		</button>
	</form>
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter) var(--gutter);
	}

	.intro {
		margin: 0 0 20px;
		color: var(--muted);
	}

	textarea.input {
		padding: 10px 14px;
		resize: vertical;
		font: inherit;
		color: inherit;
		line-height: 1.4;
	}

	.count {
		color: var(--muted);
		font-size: 0.85rem;
	}

	.sent {
		margin: -8px 0 16px;
		color: var(--muted);
		font-size: 0.9rem;
	}

	summary {
		min-height: var(--tap);
		display: flex;
		align-items: center;
		color: var(--accent);
		font-weight: 600;
		cursor: pointer;
	}

	.sent dl {
		margin: 0 0 8px;
	}

	.sent dl div {
		padding: 4px 0;
	}

	.sent dt {
		color: var(--text);
		font-weight: 600;
	}

	/* A user agent is one long word in places; it wraps rather than widening the page. */
	.sent dd {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.sent p {
		margin: 0;
	}

	/* Room for the widget before it draws, so the button doesn't jump down under the finger. */
	.widget {
		min-height: 65px;
		margin-bottom: 16px;
	}

	.offline {
		margin: 0 0 16px;
		padding: 10px 14px;
		border-radius: var(--radius);
		background: var(--warning-bg);
		color: var(--warning-text);
	}

	.widget + .hint {
		margin: -8px 0 16px;
		color: var(--muted);
		font-size: 0.9rem;
	}
</style>
