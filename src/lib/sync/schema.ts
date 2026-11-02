// What syncs, shared by the app and the Worker so they cannot disagree. Only plain data syncs
// here. A label photo's bytes do not: an item carries the photo's id (`photoId`), and on a trip
// shared with a partner the photo itself goes by its own route (worker/trips/photos.ts).

export type FieldKind = 'string' | 'int' | 'bool' | 'json';

export interface FieldSpec {
	kind: FieldKind;
	/** Can never be unset: the record cannot exist without it. */
	required?: boolean;
}

export type SyncTable = 'stores' | 'trips' | 'items';

/** Tables in the order a push must send them: a trip needs its store, an item its trip. */
export const SYNC_TABLES: SyncTable[] = ['stores', 'trips', 'items'];

const string = (required = false): FieldSpec => ({ kind: 'string', required });
const int = (required = false): FieldSpec => ({ kind: 'int', required });
const bool = (required = false): FieldSpec => ({ kind: 'bool', required });
const json = (): FieldSpec => ({ kind: 'json' });

/**
 * Each synced field, by the name the app uses. `deletedAt` is a field like any other: a delete
 * is a tombstone, and undoing it is a newer change that unsets it.
 */
export const SYNC_FIELDS: Record<SyncTable, Record<string, FieldSpec>> = {
	stores: {
		name: string(true),
		branch: string(),
		taxRateBps: int(true),
		pricesIncludeTax: bool(true),
		createdAt: int(true),
		lastUsedAt: int(true),
		deletedAt: int()
	},
	trips: {
		storeId: string(true),
		status: string(true),
		budgetMinor: int(),
		receiptTotalMinor: int(),
		discountKind: string(),
		discountValue: int(),
		photosKept: bool(true),
		startedAt: int(true),
		finishedAt: int(),
		totals: json(),
		deletedAt: int()
	},
	items: {
		tripId: string(true),
		description: string(true),
		barcode: string(),
		unitPriceMinor: int(true),
		priceIncludesTax: bool(true),
		quantity: int(true),
		offerQuantity: int(),
		offerPriceMinor: int(),
		photoId: string(),
		extracted: json(),
		edited: bool(true),
		addedBy: string(),
		createdAt: int(true),
		deletedAt: int()
	}
};

/**
 * What a record made before a required field existed gets for it, when it is sent: a number is
 * the record's own `updatedAt`, the nearest thing to when it was made. A field with no entry
 * here (a name, say) cannot be guessed, and such a record is refused as invalid.
 */
export const FIELD_DEFAULTS: Record<SyncTable, Record<string, boolean | number | 'updatedAt'>> = {
	stores: {
		taxRateBps: 0,
		pricesIncludeTax: true,
		createdAt: 'updatedAt',
		lastUsedAt: 'updatedAt'
	},
	trips: { photosKept: false, startedAt: 'updatedAt' },
	items: {
		unitPriceMinor: 0,
		priceIncludesTax: true,
		quantity: 1,
		edited: false,
		createdAt: 'updatedAt'
	}
};

/** The table a record's parent is in, and the field that names it. */
export const PARENTS: Partial<Record<SyncTable, { table: SyncTable; field: string }>> = {
	trips: { table: 'stores', field: 'storeId' },
	items: { table: 'trips', field: 'tripId' }
};

/** One field's new value and when it was set, in ms since the epoch. null unsets it. */
export interface FieldChange {
	value: unknown;
	at: number;
}

/** What the app sends: the fields of one record that changed since the last push. */
export interface PushedChange {
	table: SyncTable;
	id: string;
	fields: Record<string, FieldChange>;
}

export interface PushResult {
	table: SyncTable;
	id: string;
	status: 'ok' | 'rejected';
	/** Why a change was refused. `missing_parent` may resolve once the parent has been sent. */
	reason?: 'invalid' | 'forbidden' | 'missing_parent';
}

/** A record as the server holds it now, every synced field present (null when unset). */
export interface PulledRecord {
	table: SyncTable;
	id: string;
	fields: Record<string, unknown>;
	updatedAt: number;
}

/** A trip this account is no longer on (it left, or the owner took it off), and its store. */
export interface LeftTrip {
	tripId: string;
	storeId: string;
}

export interface PullResponse {
	records: PulledRecord[];
	/** Trips to let go of: see LeftTrip. Absent when there are none. */
	left?: LeftTrip[];
	/** Send this back as `since` to get what came after. */
	cursor: number;
	more: boolean;
}

/** Whether a value is acceptable for a field. null means unset, which required fields refuse. */
export function validValue(spec: FieldSpec, value: unknown): boolean {
	if (value === null) return !spec.required;
	switch (spec.kind) {
		case 'string':
			return typeof value === 'string' && value.length <= 2000;
		case 'int':
			return Number.isSafeInteger(value);
		case 'bool':
			return typeof value === 'boolean';
		case 'json':
			return (
				typeof value === 'object' && !Array.isArray(value) && JSON.stringify(value).length <= 4000
			);
	}
}

/** Two values are the same for sync's purposes when their JSON is. */
export const sameValue = (a: unknown, b: unknown) =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
