// Generates synthetic UK shelf-label images with known values, for the label parser accuracy
// check (scripts/label-accuracy.js) and the end-to-end capture test. Real photos go alongside
// them in fixtures/labels/ with an entry in expected.json; see fixtures/labels/README.md.
//
// Usage: node scripts/make-label-fixtures.js   (needs rsvg-convert on the PATH)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'fixtures/labels';

// EAN-13 encoding tables.
const L = [
	'0001101',
	'0011001',
	'0010011',
	'0111101',
	'0100011',
	'0110001',
	'0101111',
	'0111011',
	'0110111',
	'0001011'
];
const G = L.map((code) =>
	[...code]
		.map((b) => (b === '0' ? '1' : '0'))
		.reverse()
		.join('')
);
const R = L.map((code) => [...code].map((b) => (b === '0' ? '1' : '0')).join(''));
const PARITY = [
	'LLLLLL',
	'LLGLGG',
	'LLGGLG',
	'LLGGGL',
	'LGLLGG',
	'LGGLLG',
	'LGGGLL',
	'LGLGLG',
	'LGLGGL',
	'LGGLGL'
];

function checkDigit(twelve) {
	const sum = [...twelve].reduce((acc, d, i) => acc + Number(d) * (i % 2 ? 3 : 1), 0);
	return String((10 - (sum % 10)) % 10);
}

export function ean13(twelve) {
	return twelve + checkDigit(twelve);
}

function eanBits(code) {
	const digits = [...code].map(Number);
	const parity = PARITY[digits[0]];
	let bits = '101';
	for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? L : G)[digits[i]];
	bits += '01010';
	for (let i = 7; i <= 12; i++) bits += R[digits[i]];
	return bits + '101';
}

function barcodeSvg(code, x, y, module = 3, height = 90) {
	const bits = eanBits(code);
	let rects = '';
	for (let i = 0; i < bits.length; i++) {
		if (bits[i] === '1')
			rects += `<rect x="${x + i * module}" y="${y}" width="${module}" height="${height}"/>`;
	}
	const text = `<text x="${x + (bits.length * module) / 2}" y="${y + height + 26}" font-size="24" text-anchor="middle" font-family="DejaVu Sans Mono">${code}</text>`;
	return `<g fill="#000">${rects}</g>${text}`;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const pounds = (minor) => (minor < 100 ? `${minor}p` : `£${(minor / 100).toFixed(2)}`);

// Each layout returns SVG body content for an 800 × 480 label.
const layouts = {
	// Description top-left, big price right, unit price under it, barcode bottom-left.
	classic: (p) => `
		<rect width="800" height="480" fill="${p.bg ?? '#ffffff'}"/>
		<text x="30" y="70" font-size="40" font-weight="bold">${esc(p.lines[0])}</text>
		${p.lines[1] ? `<text x="30" y="120" font-size="40" font-weight="bold">${esc(p.lines[1])}</text>` : ''}
		<text x="770" y="290" font-size="150" font-weight="bold" text-anchor="end">${pounds(p.price)}</text>
		<text x="770" y="350" font-size="30" text-anchor="end">${esc(p.unit)}</text>
		${p.barcode ? barcodeSvg(p.barcode, 30, 300, 3, 100) : ''}`,
	// Coloured band on top with the description, price centred.
	banded: (p) => `
		<rect width="800" height="480" fill="#ffffff"/>
		<rect width="800" height="140" fill="${p.band ?? '#ffd400'}"/>
		<text x="400" y="70" font-size="38" font-weight="bold" text-anchor="middle">${esc(p.lines[0])}</text>
		${p.lines[1] ? `<text x="400" y="118" font-size="38" text-anchor="middle">${esc(p.lines[1])}</text>` : ''}
		<text x="400" y="320" font-size="160" font-weight="bold" text-anchor="middle">${pounds(p.price)}</text>
		<text x="40" y="440" font-size="30">${esc(p.unit)}</text>
		${p.barcode ? barcodeSvg(p.barcode, 470, 345, 2, 70) : ''}`,
	// Trade/wholesale label showing ex-VAT price large and inc-VAT price small.
	trade: (p) => `
		<rect width="800" height="480" fill="#ffffff"/>
		<rect x="6" y="6" width="788" height="468" fill="none" stroke="#000" stroke-width="4"/>
		<text x="30" y="70" font-size="38" font-weight="bold">${esc(p.lines[0])}</text>
		${p.lines[1] ? `<text x="30" y="118" font-size="38">${esc(p.lines[1])}</text>` : ''}
		<text x="30" y="280" font-size="130" font-weight="bold">${pounds(p.price)}</text>
		<text x="560" y="280" font-size="44" font-weight="bold">ex VAT</text>
		<text x="30" y="350" font-size="40">${pounds(Math.round(p.price * 1.2))} inc VAT</text>
		<text x="30" y="420" font-size="28">${esc(p.unit)}</text>`,
	// Offer label: "Was" price struck through and multi-buy line, current price large.
	offer: (p) => `
		<rect width="800" height="480" fill="#fff4f2"/>
		<rect width="800" height="70" fill="#d71920"/>
		<text x="400" y="50" font-size="40" font-weight="bold" fill="#fff" text-anchor="middle">${esc(p.banner)}</text>
		<text x="30" y="130" font-size="38" font-weight="bold">${esc(p.lines[0])}</text>
		${p.lines[1] ? `<text x="30" y="176" font-size="38">${esc(p.lines[1])}</text>` : ''}
		<text x="30" y="250" font-size="36">${esc(p.extra)}</text>
		<text x="770" y="380" font-size="150" font-weight="bold" text-anchor="end">${pounds(p.price)}</text>
		<text x="30" y="440" font-size="28">${esc(p.unit)}</text>`
};

// Expected values are what the parser should read. Prices include VAT unless `incl` is false.
const products = [
	{
		layout: 'classic',
		lines: ['Semi Skimmed Milk', '2.272L 4 Pints'],
		price: 145,
		unit: '64p per litre',
		barcode: ean13('501234567890')
	},
	{
		layout: 'classic',
		lines: ['Wholemeal Bread', '800g'],
		price: 135,
		unit: '16.9p per 100g',
		barcode: ean13('501000000001')
	},
	{ layout: 'classic', lines: ['Free Range Eggs', '12 Pack'], price: 389, unit: '32.4p each' },
	{ layout: 'classic', lines: ['Bananas Loose'], price: 18, unit: '£0.18 each' },
	{
		layout: 'classic',
		lines: ['British Chicken Breast', 'Fillets 650g'],
		price: 495,
		unit: '£7.62 per kg',
		barcode: ean13('500000012345')
	},
	{
		layout: 'classic',
		lines: ['Mature Cheddar', '400g'],
		price: 375,
		unit: '93.8p per 100g',
		bg: '#f2f2f2'
	},
	{
		layout: 'classic',
		lines: ['Orange Juice', 'Smooth 1L'],
		price: 210,
		unit: '£2.10 per litre',
		rotate: 2
	},
	{
		layout: 'classic',
		lines: ['Basmati Rice', '1kg'],
		price: 220,
		unit: '£2.20 per kg',
		blur: 0.8
	},
	{
		layout: 'classic',
		lines: ['Baked Beans', '4 x 415g'],
		price: 300,
		unit: '18.1p per 100g',
		barcode: ean13('501111222333')
	},
	{ layout: 'classic', lines: ['Spaghetti', '500g'], price: 75, unit: '15p per 100g', rotate: -3 },
	{
		layout: 'banded',
		lines: ['Unsalted Butter', '250g'],
		price: 249,
		unit: '£9.96 per kg',
		barcode: ean13('502222333444')
	},
	{ layout: 'banded', lines: ['Greek Style Yoghurt', '500g'], price: 165, unit: '33p per 100g' },
	{
		layout: 'banded',
		lines: ['Porridge Oats', '1kg'],
		price: 99,
		unit: '9.9p per 100g',
		band: '#7fd1ff'
	},
	{
		layout: 'banded',
		lines: ['Tomato Ketchup', '910g'],
		price: 350,
		unit: '38.5p per 100g',
		barcode: ean13('503333444555'),
		rotate: 1.5
	},
	{ layout: 'banded', lines: ['Washing Up Liquid', '900ml'], price: 125, unit: '13.9p per 100ml' },
	{
		layout: 'banded',
		lines: ['Toilet Tissue', '9 Rolls'],
		price: 525,
		unit: '58.3p per roll',
		band: '#ff9ec4'
	},
	{
		layout: 'banded',
		lines: ['Coffee Beans', '1kg'],
		price: 1200,
		unit: '£12.00 per kg',
		blur: 0.7
	},
	{
		layout: 'banded',
		lines: ['Sparkling Water', '6 x 500ml'],
		price: 240,
		unit: '8p per 100ml',
		barcode: ean13('504444555666')
	},
	{ layout: 'banded', lines: ['Red Grapes', '500g'], price: 200, unit: '£4.00 per kg', rotate: -2 },
	{
		layout: 'banded',
		lines: ['Peanut Butter', 'Crunchy 340g'],
		price: 189,
		unit: '55.6p per 100g'
	},
	{
		layout: 'trade',
		lines: ['Cola 24 x 330ml', 'Cans'],
		price: 1050,
		unit: '£1.33 per litre',
		incl: false
	},
	{
		layout: 'trade',
		lines: ['Kitchen Roll', '12 Pack'],
		price: 899,
		unit: '75p per roll',
		incl: false
	},
	{
		layout: 'trade',
		lines: ['Vegetable Oil', '20L'],
		price: 3299,
		unit: '£1.65 per litre',
		incl: false
	},
	{
		layout: 'trade',
		lines: ['Paper Plates', '100 Pack'],
		price: 650,
		unit: '6.5p each',
		incl: false,
		rotate: 1
	},
	{ layout: 'trade', lines: ['Bleach 5L'], price: 425, unit: '85p per litre', incl: false },
	{
		layout: 'offer',
		lines: ['Strawberries', '400g'],
		price: 200,
		unit: '£5.00 per kg',
		banner: 'SPECIAL OFFER',
		extra: 'Was £3.00'
	},
	{
		layout: 'offer',
		lines: ['Chocolate Digestives', '400g'],
		price: 150,
		unit: '37.5p per 100g',
		banner: 'MULTI BUY',
		extra: 'Any 2 for £2.50'
	},
	{
		layout: 'offer',
		lines: ['Salted Crisps', '6 Pack'],
		price: 175,
		unit: '29.2p each',
		banner: 'SAVE 50p',
		extra: 'Was £2.25'
	},
	{
		layout: 'offer',
		lines: ['Shower Gel', '250ml'],
		price: 100,
		unit: '40p per 100ml',
		banner: 'HALF PRICE',
		extra: 'Was £2.00',
		rotate: -1.5
	},
	{
		layout: 'offer',
		lines: ['Frozen Peas', '1kg'],
		price: 120,
		unit: '£1.20 per kg',
		banner: 'PRICE DROP',
		extra: 'Was £1.50',
		blur: 0.6
	}
];

function render(p) {
	const filters = p.blur
		? `<defs><filter id="b"><feGaussianBlur stdDeviation="${p.blur}"/></filter></defs>`
		: '';
	const transform = p.rotate ? `rotate(${p.rotate} 400 240)` : '';
	return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="580" viewBox="-50 -50 900 580" font-family="DejaVu Sans">
		${filters}<rect x="-50" y="-50" width="900" height="580" fill="#8a8f8c"/>
		<g transform="${transform}" ${p.blur ? 'filter="url(#b)"' : ''}>${layouts[p.layout](p)}</g></svg>`;
}

mkdirSync(OUT, { recursive: true });
const expectedPath = join(OUT, 'expected.json');
let expected = {};
try {
	expected = JSON.parse(readFileSync(expectedPath, 'utf8'));
} catch {
	// First run.
}

products.forEach((p, i) => {
	const name = `synthetic-${String(i + 1).padStart(2, '0')}-${p.layout}.png`;
	const svgPath = join(OUT, '.tmp.svg');
	writeFileSync(svgPath, render(p));
	execFileSync('rsvg-convert', ['-o', join(OUT, name), svgPath]);
	expected[name] = {
		description: p.lines.join(' '),
		unitPriceMinor: p.price,
		priceIncludesTax: p.incl ?? true,
		...(p.barcode && { barcode: p.barcode })
	};
});
execFileSync('rm', ['-f', join(OUT, '.tmp.svg')]);
writeFileSync(expectedPath, JSON.stringify(expected, null, '\t') + '\n');
console.log(`Wrote ${products.length} synthetic labels to ${OUT}`);
