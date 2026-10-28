/** Retail barcodes the app reads: EAN-13, UPC-A (12 digits) and EAN-8. */
export function isValidGtin(code: string): boolean {
	if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return false;
	const digits = [...code].map(Number);
	const check = digits.pop()!;
	// Weights alternate 3, 1, 3… counting from the digit next to the check digit.
	const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
	return (10 - (sum % 10)) % 10 === check;
}
