import { listTripItems } from '#lib/data/items.ts';
import { getStore } from '#lib/data/stores.ts';
import { getTrip, listFinishedTrips } from '#lib/data/trips.ts';
import { tripsToCsv, type TripForExport } from './csv.ts';
import { localDate, saveFile } from './download.ts';

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');

/** One finished trip as a CSV file. */
export async function exportTripCsv(tripId: string): Promise<void> {
	const trip = await getTrip(tripId);
	if (!trip || trip.status !== 'finished') throw new Error('This trip is not in your history.');
	const [store, items] = await Promise.all([getStore(trip.storeId), listTripItems(tripId)]);
	const name = `trolay-${slug(store?.name ?? 'trip')}-${localDate(trip.finishedAt)}.csv`;
	saveFile(name, tripsToCsv([{ trip, store, items }]), 'text/csv;charset=utf-8');
}

/** Every finished trip, oldest first, as one CSV file. */
export async function exportHistoryCsv(): Promise<void> {
	const history = (await listFinishedTrips()).reverse();
	const trips: TripForExport[] = await Promise.all(
		history.map(async ({ trip, store }) => ({ trip, store, items: await listTripItems(trip.id) }))
	);
	saveFile(`trolay-history-${localDate()}.csv`, tripsToCsv(trips), 'text/csv;charset=utf-8');
}
