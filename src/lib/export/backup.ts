import { db, type Item, type Photo, type Store, type Trip } from '#lib/data/db.ts';

// A backup for shoppers who don't sign in: every store, trip, item and kept label photo, as one
// JSON file. Records are written exactly as stored, tombstones included, so restoring gives back
// the same data. The product-name cache is left out; it refills itself.

export const BACKUP_FORMAT = 1;

interface PhotoRecord extends Omit<Photo, 'blob' | 'thumbBlob'> {
	blob: EncodedBlob;
	thumbBlob: EncodedBlob;
}

interface EncodedBlob {
	type: string;
	base64: string;
}

export interface Backup {
	app: 'trolay';
	format: number;
	exportedAt: string;
	stores: Store[];
	trips: Trip[];
	items: Item[];
	photos: PhotoRecord[];
}

export interface BackupSummary {
	stores: number;
	trips: number;
	items: number;
	photos: number;
	exportedAt: string;
}

async function encode(blob: Blob): Promise<EncodedBlob> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	// String.fromCharCode takes its arguments on the stack, so convert in slices.
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return { type: blob.type, base64: btoa(binary) };
}

function decode({ type, base64 }: EncodedBlob): Blob {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new Blob([bytes], { type });
}

export async function createBackup(): Promise<Backup> {
	return db.transaction('r', db.stores, db.trips, db.items, db.photos, async () => {
		const [stores, trips, items, photos] = await Promise.all([
			db.stores.toArray(),
			db.trips.toArray(),
			db.items.toArray(),
			db.photos.toArray()
		]);
		return {
			app: 'trolay' as const,
			format: BACKUP_FORMAT,
			exportedAt: new Date().toISOString(),
			stores,
			trips,
			items,
			photos: await Promise.all(
				photos.map(async ({ blob, thumbBlob, ...rest }) => ({
					...rest,
					blob: await encode(blob),
					thumbBlob: await encode(thumbBlob)
				}))
			)
		};
	});
}

// ---------------------------------------------------------------------------------------------
// Reading a backup back. The file may have been edited, truncated or be something else entirely,
// so every record is checked before anything on the device is touched.

class BackupError extends Error {}

type Check = (value: unknown) => boolean;
const isString: Check = (v) => typeof v === 'string';
const isNumber: Check = (v) => typeof v === 'number' && Number.isFinite(v);
const isInteger: Check = (v) => Number.isInteger(v);
const isBoolean: Check = (v) => typeof v === 'boolean';
const optional =
	(check: Check): Check =>
	(v) =>
		v === undefined || check(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const SYNC: Record<string, Check> = {
	updatedAt: isNumber,
	updatedBy: optional(isString),
	deletedAt: optional(isNumber)
};

const SHAPES: Record<'stores' | 'trips' | 'items' | 'photos', Record<string, Check>> = {
	stores: {
		...SYNC,
		id: isString,
		ownerId: optional(isString),
		name: isString,
		branch: optional(isString),
		taxRateBps: isInteger,
		pricesIncludeTax: isBoolean,
		createdAt: isNumber,
		lastUsedAt: isNumber
	},
	trips: {
		...SYNC,
		id: isString,
		ownerId: optional(isString),
		storeId: isString,
		status: (v) => v === 'open' || v === 'finished',
		budgetMinor: optional(isInteger),
		receiptTotalMinor: optional(isInteger),
		photosKept: isBoolean,
		startedAt: isNumber,
		finishedAt: optional(isNumber),
		totals: optional(
			(v) =>
				isObject(v) &&
				isInteger(v.inclMinor) &&
				isInteger(v.exclMinor) &&
				isInteger(v.itemCount) &&
				isInteger(v.taxRateBps)
		)
	},
	items: {
		...SYNC,
		id: isString,
		tripId: isString,
		description: isString,
		barcode: optional(isString),
		unitPriceMinor: isInteger,
		priceIncludesTax: isBoolean,
		quantity: isInteger,
		photoId: optional(isString),
		extracted: optional((v) => isObject(v) && isNumber(v.confidence)),
		edited: isBoolean,
		addedBy: optional(isString),
		createdAt: isNumber
	},
	photos: {
		...SYNC,
		id: isString,
		itemId: isString,
		blob: (v) => isObject(v) && isString(v.type) && isString(v.base64),
		thumbBlob: (v) => isObject(v) && isString(v.type) && isString(v.base64),
		createdAt: isNumber
	}
};

function checkRecords(backup: Record<string, unknown>, table: keyof typeof SHAPES): void {
	const records = backup[table];
	if (!Array.isArray(records)) throw new BackupError(`The backup has no ${table}.`);
	const shape = SHAPES[table];
	const ids = new Set<string>();
	records.forEach((record, i) => {
		if (!isObject(record)) throw new BackupError(`Record ${i + 1} of ${table} is not valid.`);
		for (const [field, check] of Object.entries(shape)) {
			if (!check(record[field])) {
				throw new BackupError(`Record ${i + 1} of ${table} has an invalid ${field}.`);
			}
		}
		const unknown = Object.keys(record).filter((field) => !(field in shape));
		if (unknown.length) {
			throw new BackupError(
				`Record ${i + 1} of ${table} has unknown fields: ${unknown.join(', ')}.`
			);
		}
		if (ids.has(record.id as string)) throw new BackupError(`The backup repeats a ${table} id.`);
		ids.add(record.id as string);
	});
}

/** Parses and checks a backup file's text; throws an Error saying what is wrong. */
export function readBackup(text: string): Backup {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new BackupError('This is not a Trolay backup: it is not valid JSON.');
	}
	if (!isObject(parsed) || parsed.app !== 'trolay') {
		throw new BackupError('This is not a Trolay backup.');
	}
	if (!isInteger(parsed.format) || (parsed.format as number) > BACKUP_FORMAT) {
		throw new BackupError(
			'This backup was made by a newer version of Trolay. Update the app first.'
		);
	}
	if (!isString(parsed.exportedAt)) throw new BackupError('The backup has no date.');
	for (const table of ['stores', 'trips', 'items', 'photos'] as const) checkRecords(parsed, table);

	const backup = parsed as unknown as Backup;
	const storeIds = new Set(backup.stores.map((s) => s.id));
	const tripIds = new Set(backup.trips.map((t) => t.id));
	const itemIds = new Set(backup.items.map((i) => i.id));
	if (backup.trips.some((t) => !storeIds.has(t.storeId))) {
		throw new BackupError('The backup has a trip for a store it does not include.');
	}
	if (backup.items.some((i) => !tripIds.has(i.tripId))) {
		throw new BackupError('The backup has an item for a trip it does not include.');
	}
	if (backup.photos.some((p) => !itemIds.has(p.itemId))) {
		throw new BackupError('The backup has a photo for an item it does not include.');
	}
	const open = backup.trips.filter((t) => t.status === 'open' && t.deletedAt === undefined);
	if (open.length > 1) throw new BackupError('The backup has more than one open trip.');
	return backup;
}

export function summarise(backup: Backup): BackupSummary {
	const live = <T extends { deletedAt?: number }>(records: T[]) =>
		records.filter((r) => r.deletedAt === undefined).length;
	return {
		stores: live(backup.stores),
		trips: live(backup.trips),
		items: live(backup.items),
		photos: backup.photos.length,
		exportedAt: backup.exportedAt
	};
}

/**
 * Replaces every store, trip, item and photo on the device with the backup's, all at once: if
 * anything fails, nothing changes.
 */
export async function restoreBackup(backup: Backup): Promise<void> {
	const photos: Photo[] = backup.photos.map(({ blob, thumbBlob, ...rest }) => ({
		...rest,
		blob: decode(blob),
		thumbBlob: decode(thumbBlob)
	}));
	await db.transaction('rw', db.stores, db.trips, db.items, db.photos, async () => {
		await Promise.all([db.stores.clear(), db.trips.clear(), db.items.clear(), db.photos.clear()]);
		await db.stores.bulkAdd(backup.stores);
		await db.trips.bulkAdd(backup.trips);
		await db.items.bulkAdd(backup.items);
		await db.photos.bulkAdd(photos);
	});
}
