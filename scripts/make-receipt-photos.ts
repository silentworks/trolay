// Generates photo-realistic till-receipt fixtures for the receipt reader's accuracy check.
//
// Each sample is a UK supermarket receipt in one of nine house styles (how each chain words its
// total, savings and payment lines), with the traps a real one has: subtotals, multibuy and
// loyalty savings, coupons, "TOTAL SAVINGS", a product called "TOTAL", VAT summaries, points
// balances, cash with change, split payments, cashback and gift cards. It is then photographed
// like the bottom of a receipt held in the camera guide: thermal print fade, curl, creases,
// perspective, tilt, uneven light, blur, noise and JPEG compression. Some frames stop above
// the total, so the right answer is to find none.
//
// Two sets with disjoint products: `dev` for tuning, `test` held out to measure.
// Output is deterministic; only expected.json is committed (see .gitignore).
//
// Usage: node scripts/make-receipt-photos.ts [count-dev] [count-test]   (needs rsvg-convert, magick)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rng, type Rng } from './lib/rng.ts';

const ROOT = 'fixtures/receipts';
const [devCount = 120, testCount = 240] = process.argv.slice(2).map(Number);

// ---------------------------------------------------------------------------------------------
// Products as tills abbreviate them, with prices in pence.

const PRODUCTS: [string, number][] = [
	['SEMI SKIMMED MILK 4PT', 165],
	['WHOLE MILK 2PT', 125],
	['HOVIS WHOLEMEAL 800G', 140],
	['WARBURTONS TOASTIE', 155],
	['BANANAS LOOSE', 82],
	['BRAEBURN APPLES 6PK', 189],
	['CHEDDAR MATURE 400G', 325],
	['FREE RANGE EGGS 12', 299],
	['BRITISH BUTTER 250G', 225],
	['PG TIPS 80 BAGS', 275],
	['NESCAFE GOLD 200G', 750],
	['HEINZ BEANZ 4X415G', 350],
	['CHICKEN BREAST 650G', 495],
	['BEEF MINCE 5% 500G', 425],
	['SALMON FILLETS 2PK', 450],
	['BASMATI RICE 1KG', 230],
	['PENNE PASTA 500G', 75],
	['CHOPPED TOMATOES', 55],
	['PASSATA 500G', 70],
	['OLIVE OIL 500ML', 499],
	['CORNFLAKES 500G', 195],
	['PORRIDGE OATS 1KG', 160],
	['GREEK YOGURT 500G', 210],
	['FAGE TOTAL 0% 500G', 250],
	['ORANGE JUICE 1L', 185],
	['COCA COLA 6X330ML', 499],
	['STILL WATER 6X1.5L', 230],
	['WALKERS CRISPS 6PK', 225],
	['DIGESTIVES 400G', 99],
	['DAIRY MILK 180G', 225],
	['FROZEN PEAS 1KG', 160],
	['OVEN CHIPS 1.5KG', 250],
	['PIZZA MARGHERITA', 300],
	['BROCCOLI', 59],
	['CARROTS 1KG', 55],
	['POTATOES 2.5KG', 145],
	['RED ONIONS 3PK', 85],
	['CHERRY TOMATOES', 120],
	['CUCUMBER', 70],
	['ICEBERG LETTUCE', 65],
	['AVOCADO RIPE 2PK', 175],
	['STRAWBERRIES 400G', 250],
	['BLUEBERRIES 150G', 200],
	['HOUMOUS 200G', 110],
	['SOURDOUGH LOAF', 225],
	['CROISSANTS 4PK', 165],
	['WASHING UP LIQUID', 120],
	['TOILET TISSUE 9PK', 450],
	['KITCHEN ROLL 2PK', 250],
	['BIO LIQUID 1.3L', 600],
	['TOOTHPASTE 75ML', 150],
	['SHAMPOO 400ML', 300],
	['DOG FOOD 12X100G', 525],
	['CAT LITTER 10L', 400],
	['RED WINE 75CL', 799],
	['LAGER 4X440ML', 500],
	['PROSECCO 75CL', 850],
	['SPARKLING WATER', 65],
	['COFFEE BEANS 227G', 425],
	['ALMOND MILK 1L', 160],
	['TOFU 280G', 200],
	['QUORN MINCE 300G', 300],
	['SMOKED BACON 300G', 325],
	['PORK SAUSAGES 8PK', 275],
	['HAM SLICES 125G', 150],
	['MOZZARELLA 125G', 85],
	['PARMESAN 200G', 399],
	['DOUBLE CREAM 300ML', 140],
	['ICE CREAM 900ML', 350],
	['GARLIC BULB', 30],
	['GINGER LOOSE', 45],
	['LEMONS 4PK', 99],
	['MANGO', 89],
	['PINEAPPLE', 125],
	['FLOUR PLAIN 1.5KG', 90],
	['SUGAR 1KG', 115],
	['HONEY 340G', 250],
	['JAM STRAWBERRY', 175],
	['PEANUT BUTTER', 225],
	['TUNA CHUNKS 4PK', 400]
];

// ---------------------------------------------------------------------------------------------
// House styles: how each kind of till words things.

interface Style {
	header: string[];
	fonts: string[];
	pound: boolean;
	totals: string[];
	/** Print "<n> ITEMS" on the total line, before or after the caption. */
	count: 'before' | 'after' | 'line' | 'none';
	saving: string;
	cards: string[];
	cash: string;
	change: string;
	bigTotal: boolean;
}

const MONO = ['Liberation Mono', 'Nimbus Mono PS', 'Adwaita Mono'];
const SANS = ['Liberation Sans', 'Nimbus Sans', 'Nimbus Sans Narrow'];

const STYLES: Record<string, Style> = {
	tesco: {
		header: ['TESCO', 'Every little helps'],
		fonts: MONO,
		pound: true,
		totals: ['TOTAL'],
		count: 'line',
		saving: 'Clubcard Price',
		cards: ['MASTERCARD', 'VISA', 'CONTACTLESS'],
		cash: 'CASH',
		change: 'CHANGE DUE',
		bigTotal: true
	},
	sainsburys: {
		header: ["Sainsbury's", 'Supermarkets Ltd'],
		fonts: MONO,
		pound: false,
		totals: ['BALANCE DUE'],
		count: 'before',
		saving: 'NECTAR PRICE SAVING',
		cards: ['VISA DEBIT', 'MASTERCARD', 'DEBIT CARD'],
		cash: 'CASH',
		change: 'CHANGE',
		bigTotal: false
	},
	aldi: {
		header: ['ALDI', 'Stores Ltd'],
		fonts: SANS,
		pound: false,
		totals: ['TOTAL', 'Total'],
		count: 'none',
		saving: 'Price Reduction',
		cards: ['Contactless', 'Debit', 'Card Payment'],
		cash: 'Cash',
		change: 'Change',
		bigTotal: false
	},
	lidl: {
		header: ['LIDL', 'Great Britain Ltd'],
		fonts: SANS,
		pound: false,
		totals: ['TOTAL', 'Total to pay'],
		count: 'none',
		saving: 'Lidl Plus Discount',
		cards: ['CARD', 'Card'],
		cash: 'CASH',
		change: 'CHANGE',
		bigTotal: true
	},
	coop: {
		header: ['Co-op', 'Food'],
		fonts: MONO,
		pound: true,
		totals: ['TOTAL', 'AMOUNT DUE'],
		count: 'after',
		saving: 'MEMBER PRICE',
		cards: ['VISA', 'CONTACTLESS VISA', 'MASTERCARD'],
		cash: 'CASH TENDERED',
		change: 'CHANGE GIVEN',
		bigTotal: false
	},
	morrisons: {
		header: ['MORRISONS', 'More reasons to shop'],
		fonts: MONO,
		pound: false,
		totals: ['BALANCE DUE', 'BAL DUE'],
		count: 'line',
		saving: 'MORE CARD SAVING',
		cards: ['DEBIT CARD', 'CREDIT CARD', 'VISA DEBIT'],
		cash: 'CASH',
		change: 'CHANGE',
		bigTotal: false
	},
	asda: {
		header: ['ASDA', 'Asda Stores Ltd'],
		fonts: MONO,
		pound: true,
		totals: ['TOTAL', 'TOTAL TO PAY'],
		count: 'line',
		saving: 'ROLLBACK',
		cards: ['VISA DEBIT', 'MASTERCARD', 'AMEX'],
		cash: 'CASH',
		change: 'CHANGE',
		bigTotal: true
	},
	warehouse: {
		header: ['WHOLESALE CLUB', 'Members only'],
		fonts: MONO,
		pound: false,
		totals: ['**** TOTAL', 'TOTAL'],
		count: 'none',
		saving: 'INSTANT SAVING',
		cards: ['MASTERCARD', 'VISA', 'DEBIT'],
		cash: 'CASH',
		change: 'CHANGE',
		bigTotal: false
	},
	marks: {
		header: ['M&S', 'Food'],
		fonts: SANS,
		pound: true,
		totals: ['BALANCE TO PAY', 'TOTAL'],
		count: 'none',
		saving: 'SPARKS OFFER',
		cards: ['VISA', 'APPLE PAY', 'GOOGLE PAY', 'CONTACTLESS'],
		cash: 'CASH',
		change: 'CHANGE',
		bigTotal: false
	}
};
const STYLE_NAMES = Object.keys(STYLES);

// ---------------------------------------------------------------------------------------------
// A receipt: lines of text, and the total that was paid.

interface Line {
	left: string;
	right?: string;
	size?: number;
	bold?: boolean;
	center?: boolean;
	/** The line with the total paid. */
	total?: boolean;
}

interface Receipt {
	lines: Line[];
	totalMinor: number;
	font: string;
}

function money(minor: number, pound: boolean): string {
	const sign = minor < 0 ? '-' : '';
	const abs = Math.abs(minor);
	const pounds = Math.floor(abs / 100).toLocaleString('en-GB');
	return `${sign}${pound ? '£' : ''}${pounds}.${String(abs % 100).padStart(2, '0')}`;
}

function makeReceipt(style: Style, products: [string, number][], r: Rng): Receipt {
	const m = (minor: number) => money(minor, style.pound);
	const lines: Line[] = style.header.map((left, i) => ({
		left,
		center: true,
		size: i === 0 ? 1.8 : 1,
		bold: i === 0
	}));
	lines.push({
		left: `${r.int(1, 999)} ${r.pick(['HIGH ST', 'RETAIL PARK', 'EXTRA', 'METRO'])}`,
		center: true
	});
	lines.push({ left: 'VAT No. GB ' + String(r.int(100_000_000, 999_999_999)), center: true });
	lines.push({ left: '' });
	if (r.chance(0.5)) lines.push({ left: '', right: style.pound ? '£' : 'GBP' });

	let sum = 0;
	let count = 0;
	let savings = 0;
	const n = r.int(3, 16);
	for (let i = 0; i < n; i++) {
		const [name, price] = r.pick(products);
		const qty = r.chance(0.15) ? r.int(2, 4) : 1;
		if (qty > 1) {
			lines.push({ left: name });
			lines.push({ left: `  ${qty} @ ${m(price)}`, right: m(price * qty) });
		} else {
			lines.push({ left: name, right: m(price) });
		}
		sum += price * qty;
		count += qty;
		if (r.chance(0.18)) {
			const off = Math.min(price * qty - 1, r.pick([10, 20, 25, 50, 100]));
			lines.push({ left: style.saving, right: m(-off) });
			sum -= off;
			savings += off;
		}
	}

	let total = sum;
	const hasSubtotal = r.chance(0.45);
	if (hasSubtotal) {
		lines.push({ left: '' });
		lines.push({ left: r.pick(['SUBTOTAL', 'SUB-TOTAL', 'SUB TOTAL']), right: m(sum) });
		if (r.chance(0.5)) {
			const off = Math.min(sum - 1, r.pick([100, 200, 300, 500]));
			lines.push({ left: r.pick(['COUPON', 'VOUCHER', 'STAFF DISCOUNT']), right: m(-off) });
			total -= off;
			savings += off;
		}
	}

	const caption = r.pick(style.totals);
	const countText = `${count} ${count === 1 ? 'ITEM' : 'ITEMS'}`;
	const left =
		style.count === 'before'
			? `${count} ${caption}`
			: style.count === 'after'
				? `${caption} ${countText}`
				: caption;
	lines.push({ left: '' });
	lines.push({ left, right: m(total), total: true, bold: true, size: style.bigTotal ? 1.5 : 1 });
	if (style.count === 'line') lines.push({ left: `  ${countText}` });

	// Payment.
	const kind = r.next();
	const card = r.pick(style.cards);
	if (kind < 0.55) {
		lines.push({ left: card, right: m(total) });
	} else if (kind < 0.75) {
		const note = r.pick([500, 1000, 2000]);
		const cash = Math.ceil(total / note) * note;
		lines.push({ left: style.cash, right: m(cash) });
		lines.push({ left: style.change, right: m(cash - total) });
	} else if (kind < 0.83) {
		const part = Math.min(total - 1, r.pick([500, 1000]));
		lines.push({ left: style.cash, right: m(part) });
		lines.push({ left: card, right: m(total - part) });
	} else if (kind < 0.9) {
		const back = r.pick([1000, 2000, 5000]);
		lines.push({ left: card, right: m(total + back) });
		lines.push({ left: r.pick(['CASHBACK', 'CASH BACK']), right: m(back) });
	} else if (kind < 0.95) {
		const gift = Math.min(total - 1, r.pick([500, 1000, 2500]));
		lines.push({ left: 'GIFT CARD', right: m(gift) });
		lines.push({ left: card, right: m(total - gift) });
	}
	// The rest: payment printed on a separate slip, so none here.
	if (r.chance(0.5)) lines.push({ left: `  ************${r.int(1000, 9999)}` });
	if (r.chance(0.4)) lines.push({ left: `AUTH CODE: ${r.int(100000, 999999)}` });

	lines.push({ left: '' });
	if (savings && r.chance(0.7)) {
		lines.push({
			left: r.pick(['TOTAL SAVINGS', 'YOU SAVED', 'TOTAL SAVINGS TODAY']),
			right: m(savings)
		});
	}
	if (r.chance(0.5)) {
		const vat = Math.round(total * r.range(0.02, 0.12));
		lines.push({ left: 'VAT  RATE    NET     VAT' });
		lines.push({ left: `A  20.0%  ${m(vat * 5)}`, right: m(vat) });
		if (r.chance(0.5)) lines.push({ left: 'TOTAL VAT', right: m(vat) });
	}
	if (r.chance(0.4)) {
		lines.push({ left: 'POINTS THIS VISIT', right: String(r.int(1, 60)) });
		lines.push({ left: 'POINTS BALANCE', right: String(r.int(100, 9999)) });
	}
	lines.push({ left: '' });
	lines.push({ left: 'THANK YOU FOR SHOPPING', center: true });
	lines.push({
		left: `${String(r.int(1, 28)).padStart(2, '0')}/${String(r.int(1, 12)).padStart(2, '0')}/26 ${String(r.int(8, 21)).padStart(2, '0')}:${String(r.int(0, 59)).padStart(2, '0')} ${r.int(1000, 9999)} ${r.int(10, 99)}`,
		center: true
	});
	return { lines, totalMinor: total, font: r.pick(style.fonts) };
}

// ---------------------------------------------------------------------------------------------
// Rendering and photo simulation

const PAPER_W = 576; // an 80 mm thermal roll at 180 dpi
const LINE_H = 34;
const FONT = 22;
/** An ImageMagick geometry offset: always signed, "+0" included. */
const signed = (n: number) => (Math.round(n) < 0 ? '' : '+') + Math.round(n);
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function svgOf(receipt: Receipt): { svg: string; height: number; totalY: number } {
	let y = 30;
	let totalY = 0;
	const body: string[] = [];
	for (const line of receipt.lines) {
		const size = FONT * (line.size ?? 1);
		y += LINE_H * Math.max(1, (line.size ?? 1) * 0.9);
		const weight = line.bold ? 'bold' : 'normal';
		const attrs = `font-family="${receipt.font}" font-size="${size.toFixed(1)}" font-weight="${weight}" fill="#1b1b1b"`;
		if (line.center) {
			body.push(
				`<text x="${PAPER_W / 2}" y="${y}" text-anchor="middle" ${attrs}>${escape(line.left)}</text>`
			);
		} else {
			body.push(`<text x="24" y="${y}" ${attrs} xml:space="preserve">${escape(line.left)}</text>`);
			if (line.right) {
				body.push(
					`<text x="${PAPER_W - 24}" y="${y}" text-anchor="end" ${attrs}>${escape(line.right)}</text>`
				);
			}
		}
		if (line.total) totalY = y - size * 0.35;
	}
	const height = y + 60;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PAPER_W}" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/>${body.join('')}</svg>`;
	return { svg, height, totalY };
}

/**
 * Photographs a window of the receipt around its total, as framed in a portrait 3:4 guide.
 * Returns whether the total line is in frame.
 */
function photograph(r: Rng, receipt: Receipt, tmp: string, out: string, seed: number): boolean {
	const { svg, totalY } = svgOf(receipt);
	const svgPath = join(tmp, 'r.svg');
	const png = join(tmp, 'r.png');
	writeFileSync(svgPath, svg);
	execFileSync('rsvg-convert', ['-o', png, svgPath]);

	// The paper fills 70–95% of the frame's width; the window is that tall in paper pixels.
	const fill = r.range(0.7, 0.95);
	const windowH = Math.round((PAPER_W / fill) * (4 / 3));
	// Usually the total is in frame; sometimes the shopper framed too high and missed it, well
	// clear of the edge so the right answer is not in doubt.
	// A receipt too short to frame without its total never counts as missed.
	const missAt = r.range(1.15, 1.4);
	const missed = r.chance(0.08) && totalY - missAt * windowH >= -40;
	const at = missed ? missAt : r.range(0.25, 0.85);
	const top = Math.max(-40, Math.round(totalY - at * windowH));

	const W = r.int(900, 1400);
	const H = Math.round((W * 4) / 3);
	const paperW = Math.round(W * fill);
	const scale = paperW / PAPER_W;
	const stripH = Math.round(windowH * scale);
	const background = r.pick(['#6b4f3a', '#c9b79c', '#2e2e2e', '#8a8f8c', '#d8d4cc', '#3b4a5a']);
	const paper = r.pick(['#ffffff', '#f6f4ef', '#efeee9', '#f3f0e6']);
	const strip = join(tmp, 'strip.png');

	// The paper: thermal fade, creases and a gentle curl.
	execFileSync('magick', [
		png,
		'-background',
		'white',
		'-gravity',
		'north',
		'-crop',
		`${PAPER_W}x${windowH}+0+${top}`,
		'+repage',
		'-extent',
		`${PAPER_W}x${windowH}`,
		'-resize',
		`${paperW}x${stripH}!`,
		'+level',
		`${r.int(0, 30)}%,100%`,
		'(',
		'-size',
		`${paperW}x${stripH}`,
		`xc:${paper}`,
		')',
		'-compose',
		'multiply',
		'-composite',
		'(',
		'-seed',
		String(seed),
		'-size',
		`${Math.round(paperW / 8)}x${Math.round(stripH / 8)}`,
		'plasma:grey60-grey100',
		'-colorspace',
		'gray',
		'-resize',
		`${paperW}x${stripH}!`,
		'-blur',
		'0x6',
		'+level',
		`${r.int(70, 88)}%,100%`,
		')',
		'-compose',
		'multiply',
		'-composite',
		'-alpha',
		'set',
		'-background',
		'none',
		'-wave',
		`${r.range(0, 10).toFixed(1)}x${Math.round(paperW * r.range(1.6, 3))}`,
		strip
	]);

	const jitter = () => r.range(-0.05, 0.05);
	const sw = paperW;
	const sh = stripH;
	const corners = [
		[0, 0],
		[sw, 0],
		[sw, sh],
		[0, sh]
	];
	const distort = corners
		.map(
			([x, y]) =>
				`${x},${y} ${(x + jitter() * sw).toFixed(1)},${(y + jitter() * sh * 0.5).toFixed(1)}`
		)
		.join(' ');
	const angle = r.range(-7, 7);
	const x = Math.round((W - sw) / 2 + r.range(-0.03, 0.03) * W);
	const y = Math.round((H - sh) / 2);

	const args = [
		'-seed',
		String(seed),
		'-size',
		`${W}x${H}`,
		`xc:${background}`,
		'-attenuate',
		'0.5',
		'+noise',
		'Multiplicative',
		'-blur',
		'0x3',
		'(',
		strip,
		'-virtual-pixel',
		'transparent',
		'-define',
		`distort:viewport=${Math.round(sw * 1.2)}x${Math.round(sh * 1.2)}-${Math.round(sw * 0.1)}-${Math.round(sh * 0.1)}`,
		'-distort',
		'Perspective',
		distort,
		'-background',
		'none',
		'-rotate',
		angle.toFixed(2),
		')',
		'-gravity',
		'center',
		'-geometry',
		`${signed(x - (W - sw) / 2)}${signed(y - (H - sh) / 2)}`,
		'-compose',
		'over',
		'-composite',
		'-gravity',
		'northwest',
		'(',
		'-size',
		`${W}x${H}`,
		'-define',
		`gradient:angle=${r.int(0, 359)}`,
		`gradient:gray(${r.int(92, 100)}%)-gray(${r.int(55, 85)}%)`,
		')',
		'-compose',
		'multiply',
		'-composite',
		'-compose',
		'over'
	];
	const blur = r.chance(0.3) ? 0 : r.range(0.3, 1.6);
	if (blur) args.push('-blur', `0x${blur.toFixed(2)}`);
	if (r.chance(0.12)) args.push('-motion-blur', `0x${r.range(2, 4).toFixed(1)}+${r.int(0, 180)}`);
	args.push('-attenuate', r.range(0.2, 1).toFixed(2), '+noise', 'Gaussian');
	args.push('-quality', String(r.int(60, 92)), out);
	execFileSync('magick', args);
	return !missed;
}

// ---------------------------------------------------------------------------------------------

function generate(
	set: 'dev' | 'test',
	count: number,
	products: [string, number][],
	seedBase: number
) {
	const dir = join(ROOT, set);
	rmSync(dir, { recursive: true, force: true });
	const tmp = join(dir, '.tmp');
	mkdirSync(tmp, { recursive: true });
	const expected: Record<string, { totalMinor: number | null }> = {};
	for (let i = 0; i < count; i++) {
		const seed = seedBase + i;
		const r = rng(seed);
		const styleName = STYLE_NAMES[i % STYLE_NAMES.length];
		const receipt = makeReceipt(STYLES[styleName], products, r);
		const name = `${String(i + 1).padStart(3, '0')}-${styleName}.jpg`;
		const inFrame = photograph(r, receipt, tmp, join(dir, name), seed);
		expected[name] = { totalMinor: inFrame ? receipt.totalMinor : null };
	}
	rmSync(tmp, { recursive: true, force: true });
	writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected, null, '\t') + '\n');
	console.log(`Wrote ${count} ${set} receipts to ${dir}`);
}

// Disjoint products, so the held-out set never shows a line the reader was tuned on.
const devProducts = PRODUCTS.filter((_, i) => i % 3 === 0);
const testProducts = PRODUCTS.filter((_, i) => i % 3 !== 0);
generate('dev', devCount, devProducts, 7_000);
generate('test', testCount, testProducts, 3_000_000);
