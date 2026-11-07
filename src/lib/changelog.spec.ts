import { describe, expect, it } from 'vitest';
import {
	CHANGELOG,
	entriesAfter,
	releaseDate,
	shortVersion,
	unseen,
	type ChangelogEntry
} from './changelog.ts';

const entries: ChangelogEntry[] = [
	{ version: '2026.11.07', added: ['C'] },
	{ version: '2026.11.05', changed: ['B'] },
	{ version: '2026.11.02', fixed: ['A'] }
];

describe('the changelog', () => {
	it('is newest first, one entry per version, each with something in it', () => {
		const versions = CHANGELOG.map((entry) => entry.version);
		expect(versions).toEqual([...versions].sort().reverse());
		expect(new Set(versions).size).toBe(versions.length);
		for (const entry of CHANGELOG) {
			expect(entry.version).toMatch(/^\d{4}\.\d{2}\.\d{2}$/);
			const lines = [entry.added, entry.changed, entry.removed, entry.fixed].flat();
			expect(lines.filter(Boolean).length).toBeGreaterThan(0);
			for (const line of lines) if (line !== undefined) expect(line.trim()).toBe(line);
		}
	});
});

describe('shortVersion', () => {
	it('reads a build time as its date in UTC', () => {
		expect(shortVersion(String(Date.UTC(2026, 10, 7, 23, 59)))).toBe('2026.11.07');
		expect(shortVersion(String(Date.UTC(2027, 0, 1)))).toBe('2027.01.01');
	});

	it('keeps a version that is not a time', () => {
		expect(shortVersion('dev')).toBe('dev');
	});
});

describe('what to show', () => {
	it('shows the entries after the one last seen, newest first, skipped ones included', () => {
		expect(entriesAfter('2026.11.02', entries).map((e) => e.version)).toEqual([
			'2026.11.07',
			'2026.11.05'
		]);
		expect(unseen('2026.11.05', true, entries).map((e) => e.version)).toEqual(['2026.11.07']);
		expect(unseen('2026.11.07', true, entries)).toEqual([]);
	});

	it('shows nothing on a phone never used, and the newest entry on one used before', () => {
		expect(unseen(null, false, entries)).toEqual([]);
		expect(unseen(null, true, entries).map((e) => e.version)).toEqual(['2026.11.07']);
	});
});

describe('releaseDate', () => {
	it('names the day in the phone’s language, whatever its time zone', () => {
		expect(releaseDate('2026.11.07', 'en-GB')).toBe('7 November 2026');
		expect(releaseDate('2026.11.07', 'en-US')).toBe('November 7, 2026');
		expect(releaseDate('dev', 'en-GB')).toBe('dev');
	});
});
