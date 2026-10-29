import type { Item, Store, Trip } from '#lib/data/db.ts';
import { lineTotals } from '#lib/money.ts';

// CSV for spreadsheets. Excel only reads UTF-8 (and so "£") when the file starts with a byte
// order mark, and expects CRLF line ends; Google Sheets accepts both.

export interface TripForExport {
	trip: Trip;
	store?: Store;
	items: Item[];
}

const HEADER = [
	'Date',
	'Store',
	'Description',
	'Barcode',
	'Quantity',
	'Unit price (£)',
	'Unit price includes VAT',
	'Line total incl. VAT (£)',
	'Line total excl. VAT (£)',
	'VAT (£)'
];

const pounds = (minor: number) => (minor / 100).toFixed(2);

/** "2026-10-28 17:46" in the device's time zone: sorts as text and spreadsheets read it as a date. */
function dateTime(ms: number): string {
	const d = new Date(ms);
	const two = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * A text cell. Descriptions can come from a label photo or Open Food Facts, so one starting
 * with = + - @ is prefixed with ' to stop a spreadsheet running it as a formula.
 */
function text(value: string): string {
	const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
	return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * A barcode stays text: as a number Excel would show 5.01235E+12 and drop a UPC's leading zero.
 * ="…" is the form both Excel and Google Sheets read as text.
 */
const barcode = (value: string | undefined) => (value ? `="${value}"` : '');

export function tripsToCsv(trips: TripForExport[]): string {
	const rows = [HEADER.map(text).join(',')];
	for (const { trip, store, items } of trips) {
		const taxRateBps = trip.totals?.taxRateBps ?? store?.taxRateBps ?? 0;
		const storeName = store
			? [store.name, store.branch].filter(Boolean).join(' · ')
			: 'Deleted store';
		for (const item of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
			const line = lineTotals(item, taxRateBps);
			rows.push(
				[
					dateTime(trip.finishedAt ?? trip.startedAt),
					text(storeName),
					text(item.description),
					barcode(item.barcode),
					String(item.quantity),
					pounds(item.unitPriceMinor),
					item.priceIncludesTax ? 'Yes' : 'No',
					pounds(line.inclMinor),
					pounds(line.exclMinor),
					pounds(line.inclMinor - line.exclMinor)
				].join(',')
			);
		}
	}
	return '﻿' + rows.join('\r\n') + '\r\n';
}
