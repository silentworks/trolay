import {
	SYNC_FIELDS,
	validValue,
	type FieldSpec,
	type PulledRecord,
	type SyncTable
} from '../../src/lib/sync/schema.ts';

/** `taxRateBps` is the column `tax_rate_bps`. */
export const column = (field: string) => field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export function encode(spec: FieldSpec, value: unknown): string | number | null {
	if (value === null || value === undefined) return null;
	if (spec.kind === 'bool') return value ? 1 : 0;
	if (spec.kind === 'json') return JSON.stringify(value);
	return value as string | number;
}

function decode(spec: FieldSpec, value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (spec.kind === 'bool') return value === 1;
	if (spec.kind === 'json') return JSON.parse(value as string);
	return value;
}

/** A row as the app's record: every synced field present, null where unset. */
export function toRecord(table: SyncTable, row: Record<string, unknown>): PulledRecord {
	return {
		table,
		id: row.id as string,
		updatedAt: row.updated_at as number,
		fields: Object.fromEntries(
			Object.entries(SYNC_FIELDS[table]).map(([field, spec]) => [
				field,
				decode(spec, row[column(field)])
			])
		)
	};
}

export { validValue };

/** A stable text for a value, to settle two changes made at the very same moment. */
const canonical = (value: unknown) => JSON.stringify(value ?? null);

/**
 * Whether an incoming change to a field beats what the row holds: the newer one wins, and for
 * the same moment the larger value does, so every server and device picks the same winner
 * whatever order the changes arrive in.
 */
export function beats(
	incoming: { value: unknown; at: number },
	existing: { value: unknown; at: number } | undefined
): boolean {
	if (!existing) return true;
	if (incoming.at !== existing.at) return incoming.at > existing.at;
	return canonical(incoming.value) > canonical(existing.value);
}
