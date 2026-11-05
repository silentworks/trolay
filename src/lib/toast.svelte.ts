import { untrack } from 'svelte';

export type ToastTone = 'neutral' | 'success' | 'error';

export interface ToastAction {
	label: string;
	run: () => void;
}

export interface ToastInput {
	message: string;
	tone?: ToastTone;
	action?: ToastAction;
	/** Called once it has gone without its action being taken: timed out, closed or replaced. */
	ondone?: () => void;
}

export interface ToastMessage extends Required<Omit<ToastInput, 'action' | 'ondone'>> {
	id: number;
	action?: ToastAction;
	ondone?: () => void;
}

/** Long enough to read: a little more for a long message, and twice as long for an error. */
export function durationFor(message: string, tone: ToastTone): number {
	const base = Math.max(4000, message.length * 60);
	return tone === 'error' ? base * 2 : base;
}

export type Hold = 'pointer' | 'focus';

/**
 * The app's one toast: a brief message at the bottom that goes away by itself. A new one replaces
 * the one showing. A ToastHost draws it, so any screen can show one, and it carries over a change
 * of page.
 *
 * An open modal dialog makes everything outside it inert, a toast too, so each dialog has a host
 * of its own: the one opened last draws the toast, and the one beneath takes over as it closes.
 */
class Toasts {
	current = $state.raw<ToastMessage | null>(null);
	/** How far above the bottom of the screen it sits, in px, so a screen's dock stays in view. */
	lift = $state(0);
	/** The hosts on the page, newest last; the newest draws the toast. */
	hosts = $state<symbol[]>([]);

	private count = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private started = 0;
	private remaining = 0;
	// Under a finger or the mouse, or holding focus: the timer waits.
	private holds = new Set<Hold>();

	show({ message, tone = 'neutral', action, ondone }: ToastInput): number {
		const id = ++this.count;
		this.stop();
		this.current?.ondone?.();
		this.current = { id, message, tone, action, ondone };
		this.remaining = durationFor(message, tone);
		this.holds.clear();
		this.run();
		return id;
	}

	/** Takes the toast away; with an id, only if that one is still showing. */
	dismiss(id?: number): void {
		if (id !== undefined && this.current?.id !== id) return;
		this.stop();
		this.current?.ondone?.();
		this.current = null;
	}

	/** Takes the toast's action, and takes the toast away. */
	act(): void {
		const action = this.current?.action;
		this.stop();
		this.current = null;
		action?.run();
	}

	hold(reason: Hold): void {
		this.holds.add(reason);
		this.stop();
	}

	release(reason: Hold): void {
		this.holds.delete(reason);
		this.run();
	}

	/** Adds a host; returns how to take it away again. */
	addHost(host: symbol): () => void {
		// Called from a host's effect, which must not come to depend on the list it changes.
		untrack(() => (this.hosts = [...this.hosts, host]));
		return () => untrack(() => (this.hosts = this.hosts.filter((each) => each !== host)));
	}

	isActive(host: symbol): boolean {
		return this.hosts.at(-1) === host;
	}

	private run(): void {
		const current = this.current;
		if (!current || this.timer || this.holds.size) return;
		this.started = Date.now();
		this.timer = setTimeout(() => this.dismiss(current.id), this.remaining);
	}

	private stop(): void {
		if (!this.timer) return;
		clearTimeout(this.timer);
		this.timer = undefined;
		this.remaining -= Date.now() - this.started;
	}
}

export const toast = new Toasts();
