import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

// Account moved into Settings; old links and bookmarks still land there.
export function load() {
	redirect(307, resolve('/settings/account'));
}
