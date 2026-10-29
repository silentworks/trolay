/** Hands the browser a file to save, as a download. */
export function saveFile(name: string, content: BlobPart, type: string): void {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const link = document.createElement('a');
	link.href = url;
	link.download = name;
	link.click();
	// The download has started by now; the URL is only needed until then.
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A day as YYYY-MM-DD in the device's time zone, for file names; today by default. */
export function localDate(ms = Date.now()): string {
	const d = new Date(ms);
	const two = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}
