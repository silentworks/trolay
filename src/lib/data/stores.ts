import { DEFAULT_VAT_BPS } from '#lib/money.ts';
import { db, isLive, newId, type Store } from './db';

export interface StoreInput {
	name: string;
	branch?: string;
	taxRateBps?: number;
	pricesIncludeTax?: boolean;
}

function cleanName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('A store needs a name.');
	return trimmed;
}

function cleanBranch(branch: string | undefined): string | undefined {
	return branch?.trim() || undefined;
}

/** UK defaults: 20% VAT, shelf labels include VAT. */
export async function addStore(input: StoreInput): Promise<Store> {
	const now = Date.now();
	const store: Store = {
		id: newId(),
		name: cleanName(input.name),
		branch: cleanBranch(input.branch),
		taxRateBps: input.taxRateBps ?? DEFAULT_VAT_BPS,
		pricesIncludeTax: input.pricesIncludeTax ?? true,
		createdAt: now,
		lastUsedAt: now,
		updatedAt: now
	};
	await db.stores.add(store);
	return store;
}

export async function updateStore(id: string, input: StoreInput): Promise<void> {
	await db.stores.update(id, {
		name: cleanName(input.name),
		branch: cleanBranch(input.branch),
		...(input.taxRateBps !== undefined && { taxRateBps: input.taxRateBps }),
		...(input.pricesIncludeTax !== undefined && { pricesIncludeTax: input.pricesIncludeTax }),
		updatedAt: Date.now()
	});
}

/** Most recently used first. */
export async function listStores(): Promise<Store[]> {
	const stores = await db.stores.orderBy('lastUsedAt').reverse().toArray();
	return stores.filter(isLive);
}

export async function getStore(id: string): Promise<Store | undefined> {
	const store = await db.stores.get(id);
	return isLive(store) ? store : undefined;
}
