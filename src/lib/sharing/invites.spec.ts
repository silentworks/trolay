import { describe, expect, it } from 'vitest';
import { explainMissingTrip } from './invites.ts';

const base = { refused: false, sync: 'synced', pending: 0 };

describe('explainMissingTrip', () => {
	it('says a trip from another account on this phone cannot be shared, and what to do', () => {
		const message = explainMissingTrip({ ...base, refused: true, sync: 'synced' });
		expect(message).toContain('different account');
		expect(message).toContain('Start a new trip');
		// Whatever else is going on, that is the answer: it will never get there.
		expect(explainMissingTrip({ refused: true, sync: 'error', pending: 3 })).toBe(message);
	});

	it('says so when syncing is failing, rather than blaming the connection', () => {
		const message = explainMissingTrip({ ...base, sync: 'error' });
		expect(message).toContain("Syncing isn't working");
		expect(message).not.toContain('connection');
	});

	it('asks for a connection only when there really is none', () => {
		expect(explainMissingTrip({ ...base, sync: 'offline' })).toContain('need a connection');
	});

	it('says the trip is still being sent while it is', () => {
		expect(explainMissingTrip({ ...base, pending: 2 })).toContain('still being sent');
		expect(explainMissingTrip({ ...base, sync: 'syncing' })).toContain('still being sent');
	});

	it('otherwise says the trip is not on the account, and points at the likely cause', () => {
		const message = explainMissingTrip(base);
		expect(message).toContain("isn't on your account");
		expect(message).toContain('different account');
		expect(message).not.toContain('connection');
	});
});
