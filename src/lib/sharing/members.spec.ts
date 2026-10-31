import { describe, expect, it } from 'vitest';
import { describeAdder, type TripMember } from './members.svelte.ts';

const owner: TripMember = { id: 'alice', role: 'owner', name: 'alice' };
const partner: TripMember = { id: 'bob', role: 'partner', name: null };

describe('describeAdder', () => {
	it('says "you" for the person looking', () => {
		expect(describeAdder([owner, partner], 'alice', 'alice')).toBe('you');
		expect(describeAdder([owner, partner], 'bob', 'bob')).toBe('you');
	});

	it('uses the other person’s name when they have one', () => {
		expect(describeAdder([owner, partner], 'alice', 'bob')).toBe('alice');
	});

	it('falls back to the role for a passkey-only account, which has no name', () => {
		expect(describeAdder([owner, partner], 'bob', 'alice')).toBe('your partner');
		expect(describeAdder([{ ...owner, name: null }, partner], 'alice', 'bob')).toBe(
			'the trip owner'
		);
	});

	it('says so for someone who is no longer on the trip', () => {
		expect(describeAdder([owner], 'bob', 'alice')).toBe('someone who has left');
	});
});
