import 'fake-indexeddb/auto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rng } from '../../../scripts/lib/rng.ts';
import { SYNC_FIELDS } from './schema.ts';
import {
	Clock,
	converge,
	itemFields,
	SimulatedPhone,
	SimulatedServer,
	startWithAnItem,
	type Account,
	type State
} from './harness.ts';

// What syncing promises, tried on phones that are offline, edit, and come back. The outcomes
// below are the documented ones:
//
//   - Every field settles on its own: the newest edit to it wins, wherever it was made. Two
//     phones editing different fields of one item both keep their edits.
//   - Two edits at the very same moment settle the same way on every phone and the server.
//   - A delete is a field (`deletedAt`). It is not undone by an edit to another field, even a
//     newer one, and that edit is not lost: it is there if the delete is undone. Only a newer
//     undo, or a newer delete, changes it.
//   - Whatever order the phones reconnect in, they end with the same data.

let server: SimulatedServer;
beforeAll(async () => {
	server = await SimulatedServer.start();
});
afterAll(() => server.dispose());

let clock: Clock;
let account: Account;
let n = 0;
let label: string;
beforeEach(async () => {
	clock = new Clock();
	account = await server.account();
	label = `t${++n}`;
});

const phone = (name: string) => new SimulatedPhone(name, server, account, clock);

/**
 * A record without what legitimately differs between two runs of the same story: the ids (each
 * run has its own) and the moment a delete happened (the clock moves on). Whether it was
 * deleted stays.
 */
const shape = (record: State[string]): Record<string, unknown> => {
	const { tripId: _tripId, deletedAt, ...rest } = record;
	return { ...rest, deleted: deletedAt !== undefined };
};

/** Two phones that both have the item, then both lose their signal. */
async function twoOfflinePhones(suffix = '') {
	const a = phone('a');
	const b = phone('b');
	const ids = await startWithAnItem(a, label + suffix);
	await b.sync();
	a.goOffline();
	b.goOffline();
	return { a, b, ids };
}

describe('two phones, both offline, then reconnected', () => {
	it('edit the same field of one item: the newer edit wins, and nothing else is lost', async () => {
		const { a, b, ids } = await twoOfflinePhones();
		await a.edit('items', ids.item, { unitPriceMinor: 150, quantity: 2 });
		await b.edit('items', ids.item, { unitPriceMinor: 175 }); // newer
		a.goOnline();
		b.goOnline();
		const settled = await converge([a, b]);
		expect(settled[`items/${ids.item}`]).toMatchObject({
			unitPriceMinor: 175, // the newer edit to the price
			quantity: 2, // the other phone's edit to a different field, kept
			description: 'Milk'
		});
	});

	it('edit different fields of one item: both edits are kept', async () => {
		const { a, b, ids } = await twoOfflinePhones();
		await a.edit('items', ids.item, { quantity: 3 });
		await b.edit('items', ids.item, { description: 'Oat milk', barcode: '5391511420780' });
		a.goOnline();
		b.goOnline();
		expect((await converge([a, b]))[`items/${ids.item}`]).toMatchObject({
			quantity: 3,
			description: 'Oat milk',
			barcode: '5391511420780'
		});
	});

	it('edit one field at the very same moment: every phone and the server pick the same winner', async () => {
		const { a, b, ids } = await twoOfflinePhones();
		const at = clock.tick();
		await a.edit('items', ids.item, { description: 'Apple' }, at);
		await b.edit('items', ids.item, { description: 'Banana' }, at);
		a.goOnline();
		b.goOnline();
		const settled = await converge([a, b]);
		const winner = settled[`items/${ids.item}`].description;
		expect(['Apple', 'Banana']).toContain(winner);
		// A phone that has never seen either edit gets the same answer from the server.
		const late = phone('late');
		await late.sync();
		expect((await late.get('items', ids.item))!.description).toBe(winner);

		// And it does not depend on who reconnects first.
		const other = await twoOfflinePhones('-reversed');
		const when = clock.tick();
		await other.a.edit('items', other.ids.item, { description: 'Apple' }, when);
		await other.b.edit('items', other.ids.item, { description: 'Banana' }, when);
		other.b.goOnline();
		await other.b.sync();
		other.a.goOnline();
		const reversed = await converge([other.a, other.b]);
		expect(reversed[`items/${other.ids.item}`].description).toBe(winner);
	});

	it('one deletes an item while the other edits another field: it stays deleted, and the edit is kept', async () => {
		const { a, b, ids } = await twoOfflinePhones();
		const deletedAt = await a.remove('items', ids.item);
		await b.edit('items', ids.item, { quantity: 4 }); // later than the delete
		a.goOnline();
		b.goOnline();
		const settled = await converge([a, b]);
		expect(settled[`items/${ids.item}`]).toMatchObject({ deletedAt, quantity: 4 });
		// Undoing the delete brings back the item with the edit.
		await a.restore('items', ids.item);
		const undone = await converge([a, b]);
		expect(undone[`items/${ids.item}`]).not.toHaveProperty('deletedAt');
		expect(undone[`items/${ids.item}`].quantity).toBe(4);
	});

	it('one deletes while the other edits: the same outcome in whichever order they reconnect', async () => {
		const outcomes: ReturnType<typeof shape>[] = [];
		for (const deleterFirst of [true, false]) {
			const { a, b, ids } = await twoOfflinePhones(deleterFirst ? '-1' : '-2');
			await a.remove('items', ids.item);
			await b.edit('items', ids.item, { description: 'Edited while offline' });
			const [first, second] = deleterFirst ? [a, b] : [b, a];
			first.goOnline();
			await first.sync();
			second.goOnline();
			const settled = (await converge([a, b]))[`items/${ids.item}`];
			expect(settled).toHaveProperty('deletedAt');
			outcomes.push(shape(settled));
		}
		expect(outcomes[0]).toEqual(outcomes[1]);
		expect(outcomes[0].description).toBe('Edited while offline');
	});

	it('one deletes, and the other undoes an earlier delete later: the later change wins', async () => {
		const a = phone('a');
		const b = phone('b');
		const ids = await startWithAnItem(a, label);
		await a.remove('items', ids.item);
		await a.sync();
		await b.sync();
		a.goOffline();
		b.goOffline();
		await a.remove('items', ids.item); // deleted again, later
		await b.restore('items', ids.item); // undone, later still
		a.goOnline();
		b.goOnline();
		expect((await converge([a, b]))[`items/${ids.item}`]).not.toHaveProperty('deletedAt');
	});

	it('both delete the same item: it is deleted on both', async () => {
		const { a, b, ids } = await twoOfflinePhones();
		await a.remove('items', ids.item);
		await b.remove('items', ids.item);
		a.goOnline();
		b.goOnline();
		expect((await converge([a, b]))[`items/${ids.item}`]).toHaveProperty('deletedAt');
	});

	it('rename a store on both: the newer name wins', async () => {
		const { a, b, ids } = await twoOfflinePhones();
		await a.edit('stores', ids.store, { name: 'Tesco Extra' });
		await b.edit('stores', ids.store, { name: 'Tesco Metro' });
		a.goOnline();
		b.goOnline();
		expect((await converge([a, b]))[`stores/${ids.store}`].name).toBe('Tesco Metro');
	});

	it('finish a trip on one phone while the other adds an item: the trip is finished and the item is kept', async () => {
		const { a, b, ids } = await twoOfflinePhones();
		const totals = { inclMinor: 145, exclMinor: 121, itemCount: 1, taxRateBps: 2000 };
		await a.edit('trips', ids.trip, { status: 'finished', finishedAt: clock.tick(), totals });
		await b.create('items', `late-${label}`, itemFields(ids.trip, 'Bread'));
		a.goOnline();
		b.goOnline();
		const settled = await converge([a, b]);
		expect(settled[`trips/${ids.trip}`]).toMatchObject({ status: 'finished', totals });
		// The item is not lost. (The totals are the snapshot taken at finish, so they do not
		// count an item that arrived after.)
		expect(settled[`items/late-${label}`]).toMatchObject({
			tripId: ids.trip,
			description: 'Bread'
		});
	});

	it('new records made offline on both phones end up on both', async () => {
		const { a, b, ids } = await twoOfflinePhones();
		await a.create('items', `from-a-${label}`, itemFields(ids.trip, 'From A'));
		await b.create('items', `from-b-${label}`, itemFields(ids.trip, 'From B'));
		await b.create('stores', `store-b-${label}`, {
			name: 'Lidl',
			taxRateBps: 2000,
			pricesIncludeTax: true,
			createdAt: 1,
			lastUsedAt: 1
		});
		a.goOnline();
		b.goOnline();
		const settled = await converge([a, b]);
		expect(Object.keys(settled)).toEqual(
			expect.arrayContaining([
				`items/from-a-${label}`,
				`items/from-b-${label}`,
				`stores/store-b-${label}`
			])
		);
	});

	it('syncing again, and again, changes nothing', async () => {
		const { a, b, ids } = await twoOfflinePhones();
		await a.edit('items', ids.item, { quantity: 2 });
		await b.edit('items', ids.item, { description: 'Edited' });
		a.goOnline();
		b.goOnline();
		const first = await converge([a, b]);
		for (let i = 0; i < 3; i++) {
			await a.sync();
			await b.sync();
		}
		expect(await a.state()).toEqual(first);
		expect(await b.state()).toEqual(first);
		expect(await a.pending()).toBe(0);
	});
});

describe('more than two phones', () => {
	it('three phones edit the same item while apart, and all end the same, in any order of reconnecting', async () => {
		const orders = [
			[0, 1, 2],
			[2, 1, 0],
			[1, 2, 0]
		];
		const finals: unknown[] = [];
		for (const order of orders) {
			const phones = [phone('a'), phone('b'), phone('c')];
			const ids = await startWithAnItem(phones[0], `${label}-${order.join('')}`);
			await phones[1].sync();
			await phones[2].sync();
			for (const p of phones) p.goOffline();
			await phones[0].edit('items', ids.item, { quantity: 2, description: 'From A' });
			await phones[1].edit('items', ids.item, { quantity: 3 });
			await phones[2].edit('items', ids.item, { description: 'From C', unitPriceMinor: 99 });
			await phones[1].remove('items', ids.item);
			for (const i of order) {
				phones[i].goOnline();
				await phones[i].sync();
			}
			const settled = await converge(phones);
			finals.push(shape(settled[`items/${ids.item}`]));
		}
		expect(finals[1]).toEqual(finals[0]);
		expect(finals[2]).toEqual(finals[0]);
	});

	it('a phone that stays offline does not hold the others up, and catches up when it returns', async () => {
		const a = phone('a');
		const b = phone('b');
		const c = phone('c');
		const ids = await startWithAnItem(a, label);
		await b.sync();
		await c.sync();
		c.goOffline();
		await a.edit('items', ids.item, { quantity: 2 });
		await c.edit('items', ids.item, { description: 'Edited on c' });
		const without = await converge([a, b]);
		expect(without[`items/${ids.item}`]).toMatchObject({ quantity: 2, description: 'Milk' });
		c.goOnline();
		const all = await converge([a, b, c]);
		expect(all[`items/${ids.item}`]).toMatchObject({ quantity: 2, description: 'Edited on c' });
	});
});

describe('random histories', () => {
	// Several phones make random edits, deletes, undos and new items, lose and regain their signal,
	// and sync at random moments. At the end every phone must hold exactly what the rules say:
	// for each field, the value of the newest edit made to it anywhere, so that nothing is lost.

	const FIELDS = ['description', 'quantity', 'unitPriceMinor', 'barcode'] as const;

	interface Edit {
		at: number;
		value: unknown;
	}

	async function randomHistory(seed: number) {
		const random = rng(seed);
		const owner = await server.account();
		const time = new Clock();
		const phones = ['a', 'b', 'c'].map((name) => new SimulatedPhone(name, server, owner, time));

		// The answer, worked out apart from the sync code: the newest edit to each field.
		const expected = new Map<string, Map<string, Edit>>();
		const note = (id: string, field: string, at: number, value: unknown) => {
			const fields = expected.get(id) ?? new Map<string, Edit>();
			const known = fields.get(field);
			if (!known || known.at < at) fields.set(field, { at, value });
			expected.set(id, fields);
		};
		const noteAll = (id: string, at: number, fields: Record<string, unknown>) => {
			for (const [field, value] of Object.entries(fields)) note(id, field, at, value);
		};

		const ids = await startWithAnItem(phones[0], `rand-${seed}`);
		noteAll(ids.item, 0, itemFields(ids.trip)); // older than every edit that follows
		for (const other of phones.slice(1)) await other.sync();

		let created = 0;
		for (let step = 0; step < 50; step++) {
			const p = random.pick(phones);
			const action = random.next();
			if (action < 0.12) {
				if (p.online) p.goOffline();
				else p.goOnline();
			} else if (action < 0.3) {
				await p.sync();
			} else if (action < 0.4) {
				const id = `new-${seed}-${++created}`;
				const fields = itemFields(ids.trip, `Item ${created}`);
				noteAll(id, await p.create('items', id, fields), fields);
			} else {
				// Edit, delete or undo an item this phone has.
				const state = await p.state();
				const mine = Object.keys(state)
					.filter((key) => key.startsWith('items/'))
					.map((key) => key.slice('items/'.length));
				const id = random.pick(mine);
				const kind = random.next();
				if (kind < 0.2) {
					const at = await p.remove('items', id);
					note(id, 'deletedAt', at, at);
				} else if (kind < 0.35 && state[`items/${id}`].deletedAt !== undefined) {
					// An undo is only something to do to an item this phone shows as deleted.
					note(id, 'deletedAt', await p.restore('items', id), undefined);
				} else {
					const field = random.pick(FIELDS);
					const value =
						field === 'description'
							? `d${step}`
							: field === 'barcode'
								? `${5000000000000 + step}`
								: random.int(1, 99);
					note(id, field, await p.edit('items', id, { [field]: value }), value);
				}
			}
		}
		return { phones, expected, owner };
	}

	it.each([1, 2, 3, 4, 5, 6])(
		'seed %i: every phone ends with exactly the newest edit of every field',
		async (seed) => {
			const { phones, expected, owner } = await randomHistory(seed);
			for (const p of phones) p.goOnline();
			await converge(phones, 12);

			// A phone that has never seen any of it reads the server, which must agree too.
			const witness = new SimulatedPhone('witness', server, owner, new Clock());
			await witness.sync();

			for (const p of [...phones, witness]) {
				const state = await p.state();
				for (const [id, fields] of expected) {
					const record = state[`items/${id}`];
					expect(record, `${p.name} has ${id}`).toBeDefined();
					for (const field of Object.keys(SYNC_FIELDS.items)) {
						expect(record[field], `${p.name} ${id}.${field}`).toEqual(fields.get(field)?.value);
					}
				}
			}
		},
		60_000
	);
});
