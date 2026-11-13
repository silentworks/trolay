// Whether the phone has a connection, for everyone, signed in or not. The sync engine keeps its
// own copy for syncing; this one is for showing it (the header's offline icon).

class Connection {
	online = $state(true);

	constructor() {
		if (typeof window === 'undefined') return;
		this.online = navigator.onLine;
		window.addEventListener('online', () => (this.online = true));
		window.addEventListener('offline', () => (this.online = false));
	}
}

export const connection = new Connection();
