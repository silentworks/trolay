// Generates photo-realistic shelf-label fixtures for the label reader's accuracy check.
//
// Each sample is a real-looking UK label (eight layouts: classic supermarket, coloured band,
// discounter with raised pence, warehouse, trade inc/ex VAT, offers, electronic shelf label,
// pence-only) for a product from the catalogue below, then degraded like a phone photo:
// perspective and tilt, uneven light, sleeve glare, blur, noise, JPEG compression, shelf-coloured
// backgrounds, and sometimes part of the neighbouring label (with its own price) in frame.
//
// Two sets with disjoint products: `dev` for tuning the reader, `test` held out to measure it.
// Output is deterministic for a given seed; images are not committed (see .gitignore), only
// expected.json, so `pnpm fixtures:labels` recreates them.
//
// Usage: node scripts/make-label-photos.ts [count-dev] [count-test]   (needs rsvg-convert, magick)
//        node scripts/make-label-photos.ts holdout [count]
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { rng, type Rng } from './lib/rng.ts';

const ROOT = 'fixtures/labels';
// `holdout` makes a fresh set of the test products from new seeds, for a measurement nothing
// was tuned on (the test set's failures were looked at once, so it no longer qualifies).
const holdout = process.argv[2] === 'holdout';
const [devCount = 160, testCount = 320] = process.argv.slice(holdout ? 3 : 2).map(Number);

// ---------------------------------------------------------------------------------------------
// Products: name, pack size, price in pence, unit-price basis.

type Basis = 'kg' | '100g' | 'litre' | '100ml' | 'each' | 'roll' | 'sheet100';
type Product = { name: string; size: string; price: number; basis: Basis; amount: number };

const P = (name: string, size: string, price: number, basis: Basis, amount: number): Product => ({
	name,
	size,
	price,
	basis,
	amount
});

// amount: grams, millilitres or items, matching the basis.
const PRODUCTS: Product[] = [
	P('Semi Skimmed Milk', '2.272L', 145, 'litre', 2272),
	P('Whole Milk', '1.136L', 105, 'litre', 1136),
	P('Wholemeal Bread', '800g', 135, '100g', 800),
	P('White Sliced Bread', '800g', 125, '100g', 800),
	P('Free Range Eggs', '12 Pack', 389, 'each', 12),
	P('Large Brown Eggs', '6 Pack', 199, 'each', 6),
	P('Mature Cheddar', '400g', 375, 'kg', 400),
	P('Red Leicester', '350g', 315, 'kg', 350),
	P('Greek Style Yoghurt', '500g', 165, '100g', 500),
	P('Natural Yoghurt', '1kg', 175, '100g', 1000),
	P('Unsalted Butter', '250g', 249, 'kg', 250),
	P('Spreadable Butter', '500g', 399, 'kg', 500),
	P('Orange Juice Smooth', '1L', 210, 'litre', 1000),
	P('Apple Juice', '1L', 95, 'litre', 1000),
	P('Basmati Rice', '1kg', 220, 'kg', 1000),
	P('Long Grain Rice', '500g', 89, 'kg', 500),
	P('Spaghetti', '500g', 75, '100g', 500),
	P('Penne Pasta', '1kg', 135, '100g', 1000),
	P('Baked Beans', '4 x 415g', 300, '100g', 1660),
	P('Chopped Tomatoes', '400g', 49, '100g', 400),
	P('Tomato Ketchup', '910g', 350, '100g', 910),
	P('Mayonnaise', '600ml', 299, '100ml', 600),
	P('Porridge Oats', '1kg', 99, '100g', 1000),
	P('Cornflakes', '720g', 249, '100g', 720),
	P('Bran Flakes', '750g', 189, '100g', 750),
	P('Chocolate Digestives', '400g', 150, '100g', 400),
	P('Rich Tea Biscuits', '300g', 85, '100g', 300),
	P('Salted Crisps', '6 x 25g', 175, '100g', 150),
	P('Ready Salted Crisps', '150g', 125, '100g', 150),
	P('Peanut Butter Crunchy', '340g', 189, '100g', 340),
	P('Strawberry Jam', '454g', 145, '100g', 454),
	P('Clear Honey', '340g', 299, '100g', 340),
	P('Instant Coffee', '200g', 650, '100g', 200),
	P('Coffee Beans', '1kg', 1200, 'kg', 1000),
	P('Tea Bags', '240 Pack', 450, 'each', 240),
	P('Earl Grey Tea', '80 Pack', 215, 'each', 80),
	P('Sparkling Water', '6 x 500ml', 240, '100ml', 3000),
	P('Still Spring Water', '2L', 55, 'litre', 2000),
	P('Cola', '2L', 199, 'litre', 2000),
	P('Lemonade', '2L', 85, 'litre', 2000),
	P('Washing Up Liquid', '900ml', 125, '100ml', 900),
	P('Laundry Liquid', '1.4L', 650, 'litre', 1400),
	P('Toilet Tissue', '9 Rolls', 525, 'roll', 9),
	P('Kitchen Roll', '4 Rolls', 375, 'roll', 4),
	P('Bananas Loose', 'Each', 18, 'each', 1),
	P('Red Grapes', '500g', 200, 'kg', 500),
	P('Strawberries', '400g', 200, 'kg', 400),
	P('Blueberries', '150g', 175, 'kg', 150),
	P('Gala Apples', '6 Pack', 165, 'each', 6),
	P('Baby Potatoes', '1kg', 115, 'kg', 1000),
	P('Carrots', '1kg', 55, 'kg', 1000),
	P('Broccoli', '360g', 69, 'kg', 360),
	P('Cherry Tomatoes', '250g', 99, 'kg', 250),
	P('Iceberg Lettuce', 'Each', 65, 'each', 1),
	P('British Chicken Breast Fillets', '650g', 495, 'kg', 650),
	P('Beef Mince 5% Fat', '500g', 425, 'kg', 500),
	P('Smoked Back Bacon', '300g', 275, 'kg', 300),
	P('Pork Sausages', '454g', 250, 'kg', 454),
	P('Salmon Fillets', '240g', 450, 'kg', 240),
	P('Cod Fillets', '280g', 499, 'kg', 280),
	P('Frozen Peas', '1kg', 120, 'kg', 1000),
	P('Oven Chips', '1.5kg', 225, 'kg', 1500),
	P('Fish Fingers', '10 Pack', 199, 'each', 10),
	P('Margherita Pizza', '300g', 150, 'kg', 300),
	P('Vanilla Ice Cream', '2L', 200, 'litre', 2000),
	P('Garden Peas', '290g', 45, '100g', 290),
	P('Tuna Chunks in Brine', '4 x 145g', 499, '100g', 580),
	P('Chicken Noodle Soup', '400g', 95, '100g', 400),
	P('Tomato Soup', '400g', 89, '100g', 400),
	P('Vegetable Oil', '1L', 199, 'litre', 1000),
	P('Extra Virgin Olive Oil', '500ml', 525, '100ml', 500),
	P('Avocado Oil', '2L', 1999, 'litre', 2000),
	P('Plain Flour', '1.5kg', 85, 'kg', 1500),
	P('Granulated Sugar', '1kg', 115, 'kg', 1000),
	P('Table Salt', '750g', 45, 'kg', 750),
	P('Ground Black Pepper', '100g', 150, '100g', 100),
	P('Mixed Herbs', '14g', 95, '100g', 14),
	P('Chicken Stock Cubes', '12 Pack', 115, 'each', 12),
	P('Gravy Granules', '200g', 165, '100g', 200),
	P('Brown Sauce', '425g', 199, '100g', 425),
	P('Sweet Chilli Sauce', '275ml', 149, '100ml', 275),
	P('Soy Sauce', '150ml', 129, '100ml', 150),
	P('Hummus', '200g', 75, '100g', 200),
	P('Houmous Reduced Fat', '300g', 125, '100g', 300),
	P('Cottage Cheese', '300g', 115, '100g', 300),
	P('Double Cream', '300ml', 135, '100ml', 300),
	P('Single Cream', '300ml', 99, '100ml', 300),
	P('Oat Drink', '1L', 180, 'litre', 1000),
	P('Almond Drink', '1L', 150, 'litre', 1000),
	P('Dark Chocolate', '100g', 120, '100g', 100),
	P('Milk Chocolate Buttons', '119g', 135, '100g', 119),
	P('Salted Peanuts', '200g', 99, '100g', 200),
	P('Cashew Nuts', '200g', 275, '100g', 200),
	P('Raisins', '500g', 175, '100g', 500),
	P('Dried Apricots', '250g', 165, '100g', 250),
	P('Crunchy Granola', '1kg', 350, '100g', 1000),
	P('Rice Cakes', '130g', 89, '100g', 130),
	P('Crumpets', '6 Pack', 85, 'each', 6),
	P('Plain Bagels', '5 Pack', 125, 'each', 5),
	P('Croissants', '4 Pack', 150, 'each', 4),
	P('Wholemeal Wraps', '8 Pack', 165, 'each', 8),
	P('Naan Breads', '4 Pack', 145, 'each', 4),
	P('Cheese Slices', '200g', 199, '100g', 200),
	P('Mozzarella', '125g', 79, '100g', 125),
	P('Feta Cheese', '200g', 225, '100g', 200),
	P('Halloumi', '250g', 299, '100g', 250),
	P('Parmesan', '200g', 399, '100g', 200),
	P('Smoked Salmon', '100g', 325, '100g', 100),
	P('King Prawns', '180g', 400, '100g', 180),
	P('Chicken Thighs', '1kg', 375, 'kg', 1000),
	P('Lamb Mince', '500g', 499, 'kg', 500),
	P('Sliced Ham', '400g', 299, 'kg', 400),
	P('Pepperoni Slices', '100g', 150, '100g', 100),
	P('Coleslaw', '300g', 85, '100g', 300),
	P('Potato Salad', '250g', 95, '100g', 250),
	P('Mixed Salad Leaves', '120g', 99, '100g', 120),
	P('Spinach', '240g', 125, 'kg', 240),
	P('Mushrooms', '400g', 109, 'kg', 400),
	P('Red Onions', '1kg', 89, 'kg', 1000),
	P('Garlic Bulbs', '4 Pack', 79, 'each', 4),
	P('Lemons', '4 Pack', 99, 'each', 4),
	P('Limes', '5 Pack', 105, 'each', 5),
	P('Avocados', '2 Pack', 159, 'each', 2),
	P('Sweet Potatoes', '1kg', 125, 'kg', 1000),
	P('Butternut Squash', 'Each', 99, 'each', 1),
	P('Cucumber', 'Each', 65, 'each', 1),
	P('Peppers Mixed', '3 Pack', 155, 'each', 3),
	P('Frozen Berries', '500g', 275, 'kg', 500),
	P('Garlic Bread', '2 Pack', 99, 'each', 2),
	P('Lasagne', '400g', 325, 'kg', 400),
	P('Chicken Tikka Masala', '400g', 375, 'kg', 400),
	P('Beef Burgers', '4 Pack', 299, 'each', 4),
	P('Vegetable Spring Rolls', '12 Pack', 175, 'each', 12),
	P('Toothpaste', '75ml', 199, '100ml', 75),
	P('Shower Gel', '250ml', 100, '100ml', 250),
	P('Shampoo', '400ml', 299, '100ml', 400),
	P('Hand Wash', '250ml', 85, '100ml', 250),
	P('Bleach', '750ml', 69, '100ml', 750),
	P('Bin Bags', '20 Pack', 199, 'each', 20),
	P('Aluminium Foil', '10m', 175, 'each', 1),
	P('Cling Film', '30m', 129, 'each', 1),
	P('Dishwasher Tablets', '40 Pack', 750, 'each', 40),
	P('Fabric Conditioner', '1.19L', 350, 'litre', 1190),
	P('Cat Food Pouches', '12 x 100g', 450, 'kg', 1200),
	P('Dog Biscuits', '1kg', 299, 'kg', 1000),
	P('Baby Wipes', '64 Pack', 125, 'each', 64),
	P('Nappies Size 4', '44 Pack', 999, 'each', 44),
	P('Paracetamol Tablets', '16 Pack', 45, 'each', 16),
	P('Sparkling Elderflower', '750ml', 225, 'litre', 750),
	P('Ginger Beer', '4 x 330ml', 299, 'litre', 1320),
	P('Lager Cans', '10 x 440ml', 1100, 'litre', 4400),
	P('Red Wine', '75cl', 699, 'litre', 750),
	P('Prosecco', '75cl', 850, 'litre', 750),
	P('Energy Drink', '500ml', 145, 'litre', 500),
	P('Sports Drink', '500ml', 125, 'litre', 500),
	P('Cereal Bars', '6 Pack', 199, 'each', 6),
	P('Flapjacks', '5 Pack', 175, 'each', 5),
	P('Popcorn Sweet & Salty', '100g', 125, '100g', 100),
	P('Tortilla Chips', '200g', 135, '100g', 200),
	P('Salsa Dip', '300g', 165, '100g', 300),
	P('Pesto Sauce', '190g', 175, '100g', 190),
	P('Curry Paste', '165g', 199, '100g', 165),
	P('Coconut Milk', '400ml', 99, '100ml', 400),
	P('Kidney Beans', '400g', 55, '100g', 400),
	P('Chickpeas', '400g', 59, '100g', 400),
	P('Lentils Red Split', '500g', 125, 'kg', 500),
	P('Couscous', '500g', 99, 'kg', 500),
	P('Egg Noodles', '250g', 89, '100g', 250),
	P('Pasta Sauce', '500g', 145, '100g', 500),
	P('Mushroom Risotto Rice', '1kg', 225, 'kg', 1000)
];

// ---------------------------------------------------------------------------------------------
// Formatting

const pounds = (minor: number) => `£${(minor / 100).toFixed(2)}`;
const plain = (minor: number) => (minor / 100).toFixed(2);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** The unit price as UK labels print it, e.g. "64p per litre", "£9.96 per kg", "16.9p per 100g". */
function unitPrice(p: Product, r: Rng): string {
	const per = { kg: 1000, '100g': 100, litre: 1000, '100ml': 100, each: 1, roll: 1, sheet100: 1 }[
		p.basis
	];
	const value = (p.price * per) / p.amount; // pence per basis
	const word = {
		kg: 'kg',
		'100g': '100g',
		litre: 'litre',
		'100ml': '100ml',
		each: 'each',
		roll: 'roll',
		sheet100: '100 sheets'
	}[p.basis];
	if (value >= 100) {
		const v = `£${(value / 100).toFixed(2)}`;
		return r.chance(0.5) ? `${v} per ${word}` : `${v}/${word}`;
	}
	const v = p.basis === '100g' || p.basis === '100ml' ? value.toFixed(1) : value.toFixed(0);
	return r.chance(0.5) ? `${v}p per ${word}` : `${v}p/${word}`;
}

/** Splits a description over at most two lines, roughly in half by words. */
function twoLines(text: string, r: Rng, maxChars = 24): string[] {
	if (text.length <= maxChars && r.chance(0.6)) return [text];
	const words = text.split(' ');
	let best = 1;
	let bestDiff = Infinity;
	for (let i = 1; i < words.length; i++) {
		const a = words.slice(0, i).join(' ').length;
		const b = words.slice(i).join(' ').length;
		if (Math.abs(a - b) < bestDiff) {
			bestDiff = Math.abs(a - b);
			best = i;
		}
	}
	return words.length > 1 ? [words.slice(0, best).join(' '), words.slice(best).join(' ')] : [text];
}

function ean13(r: Rng): string {
	const digits = [5, 0, ...Array.from({ length: 10 }, () => r.int(0, 9))];
	const sum = digits.reduce((acc, d, i) => acc + d * (i % 2 ? 3 : 1), 0);
	return digits.join('') + String((10 - (sum % 10)) % 10);
}

function barcodeSvg(
	code: string,
	x: number,
	y: number,
	module: number,
	height: number,
	withText = true
) {
	// Bars are decorative (not decodable): the reader takes barcodes from the barcode scanner.
	let bars = '';
	let pos = x;
	for (const ch of code + code.slice(0, 5)) {
		const d = Number(ch);
		bars += `<rect x="${pos}" y="${y}" width="${module * (1 + (d % 3))}" height="${height}"/>`;
		pos += module * (2 + (d % 4));
	}
	const text = withText
		? `<text x="${x}" y="${y + height + module * 9}" font-size="${module * 8}" font-family="Liberation Mono">${code}</text>`
		: '';
	return `<g fill="#111">${bars}</g>${text}`;
}

// ---------------------------------------------------------------------------------------------
// Layouts. Each returns an SVG of the label (W × H) and what the reader should find.

interface Label {
	svg: string;
	width: number;
	height: number;
	description: string[];
	price: number;
	vat: 'inc' | 'ex' | null;
	/** A multi-buy offer printed on the label ("Any 2 for £2.50"). */
	offer?: { quantity: number; totalMinor: number };
}

const SANS = ['Liberation Sans', 'Nimbus Sans', 'Noto Sans', 'Adwaita Sans'];
const SERIF = ['Liberation Serif', 'Nimbus Roman', 'C059'];
const NARROW = ['Nimbus Sans Narrow'];

function descriptionText(p: Product, r: Rng, caps = false) {
	const text = p.size === 'Each' ? p.name : `${p.name} ${p.size}`;
	return caps ? text.toUpperCase() : text;
}

function text(x: number, y: number, size: number, content: string, font: string, attrs = '') {
	return `<text x="${x}" y="${y}" font-size="${size}" font-family="${font}" ${attrs}>${esc(content)}</text>`;
}

const layouts: Record<string, (p: Product, r: Rng) => Label> = {
	classic(p, r) {
		const W = 1000;
		const H = 600;
		const font = r.pick(SANS);
		const desc = descriptionText(p, r);
		const lines = twoLines(desc, r, 30);
		const size = r.int(40, 50);
		const price = p.price < 100 && r.chance(0.5) ? `${p.price}p` : pounds(p.price);
		let svg = `<rect width="${W}" height="${H}" fill="${r.pick(['#fff', '#fbfbf7', '#f4f6f8'])}"/>`;
		lines.forEach(
			(l, i) => (svg += text(40, 80 + i * (size + 12), size, l, font, 'font-weight="bold"'))
		);
		svg += text(W - 40, 390, r.int(170, 200), price, font, 'font-weight="bold" text-anchor="end"');
		svg += text(W - 40, 455, 34, unitPrice(p, r), font, 'text-anchor="end"');
		if (r.chance(0.7)) svg += barcodeSvg(ean13(r), 40, 430, 3, 90);
		return { svg, width: W, height: H, description: [desc], price: p.price, vat: null };
	},
	band(p, r) {
		const W = 1000;
		const H = 600;
		const font = r.pick(SANS);
		const desc = descriptionText(p, r);
		const lines = twoLines(desc, r, 28);
		const band = r.pick(['#ffd400', '#7fd1ff', '#ff9ec4', '#9be7a0', '#f28c28', '#e5e5e5']);
		let svg = `<rect width="${W}" height="${H}" fill="#fff"/><rect width="${W}" height="170" fill="${band}"/>`;
		lines.forEach(
			(l, i) =>
				(svg += text(
					W / 2,
					75 + i * 52,
					44,
					l,
					font,
					`text-anchor="middle" ${i ? '' : 'font-weight="bold"'}`
				))
		);
		svg += text(
			W / 2,
			400,
			r.int(170, 200),
			pounds(p.price),
			font,
			'font-weight="bold" text-anchor="middle"'
		);
		svg += text(40, 560, 34, unitPrice(p, r), font);
		if (r.chance(0.6)) svg += barcodeSvg(ean13(r), 600, 470, 2.5, 70);
		return { svg, width: W, height: H, description: [desc], price: p.price, vat: null };
	},
	discounter(p, r) {
		// Big pounds with small raised pence and a small £: "£2⁴⁹".
		const W = 1000;
		const H = 600;
		const font = r.pick([...SANS, ...NARROW]);
		const desc = descriptionText(p, r, true);
		const lines = twoLines(desc, r, 26);
		const whole = Math.floor(p.price / 100);
		const pence = String(p.price % 100).padStart(2, '0');
		const bg = r.pick(['#fff', '#fff6d6', '#eaf3ff']);
		let svg = `<rect width="${W}" height="${H}" fill="${bg}"/>`;
		lines.forEach((l, i) => (svg += text(40, 75 + i * 50, 42, l, font, 'font-weight="bold"')));
		const big = r.int(230, 270);
		const x = r.int(470, 560);
		svg += text(x - 10, 260, 70, '£', font, 'font-weight="bold" text-anchor="end"');
		svg += text(x, 430, big, String(whole), font, 'font-weight="bold"');
		const wholeWidth = String(whole).length * big * 0.56;
		svg += text(x + wholeWidth + 8, 300, Math.round(big * 0.42), pence, font, 'font-weight="bold"');
		svg += text(40, 540, 32, `(${unitPrice(p, r)})`, font);
		return { svg, width: W, height: H, description: [desc], price: p.price, vat: null };
	},
	warehouse(p, r) {
		// Like the warehouse-club sign in fixtures/labels/real: item number, caps serif name,
		// captioned unit price to three decimals and captioned sell price without a £ sign.
		const W = 1000;
		const H = 640;
		const font = r.pick(SERIF);
		const lines = descriptionText(p, r, true)
			.replace(/\s+(\S+)$/, '\n$1')
			.split('\n');
		const nameLines = twoLines(lines[0], r, 18).concat(lines.slice(1));
		const description = nameLines.join(' ');
		// Warehouse signs give the unit price per litre, per kg or per item.
		const per =
			p.basis === 'litre' || p.basis === '100ml'
				? 'LITRE'
				: p.basis === 'kg' || p.basis === '100g'
					? 'KG'
					: 'UNIT';
		const perAmount = per === 'UNIT' ? 1 : 1000;
		const unit = ((p.price / 100) * perAmount) / p.amount;
		let svg = `<rect width="${W}" height="${H}" fill="#fff"/>`;
		svg += text(140, 105, 100, String(r.int(1000000, 1999999)), font);
		nameLines.forEach((l, i) => (svg += text(60, 175 + i * 58, 54, l, font)));
		const captionY = 175 + nameLines.length * 58 + 40;
		svg += text(
			60,
			captionY,
			24,
			`PRICE PER ${r.pick([per, per === 'LITRE' ? 'LITER' : per])}`,
			font
		);
		svg += text(60, captionY + 50, 44, unit.toFixed(3), font);
		svg += text(W - 230, captionY, 26, 'SELL PRICE', font);
		svg += text(
			W - 60,
			captionY + 150,
			r.int(180, 200),
			plain(p.price),
			font,
			'font-weight="bold" text-anchor="end"'
		);
		svg += text(
			W - 70,
			H - 20,
			18,
			`${r.int(1, 12)}/${r.int(1, 28)}/${r.int(23, 26)}`,
			font,
			'text-anchor="end"'
		);
		return { svg, width: W, height: H, description: [description], price: p.price, vat: null };
	},
	trade(p, r) {
		// Wholesale label with both prices; either may be the big one.
		const W = 1000;
		const H = 600;
		const font = r.pick(SANS);
		const desc = descriptionText(p, r);
		const lines = twoLines(desc, r, 26);
		const ex = p.price;
		const inc = Math.round(ex * 1.2);
		const exBig = r.chance(0.6);
		const markers = r.pick([
			['ex VAT', 'inc VAT'],
			['+VAT', 'inc VAT'],
			['EXC VAT', 'INC VAT'],
			['excl. VAT', 'incl. VAT']
		]);
		const [bigPrice, smallPrice] = exBig ? [ex, inc] : [inc, ex];
		const [bigMark, smallMark] = exBig ? markers : [markers[1], markers[0]];
		let svg = `<rect width="${W}" height="${H}" fill="#fff"/><rect x="6" y="6" width="${W - 12}" height="${H - 12}" fill="none" stroke="#000" stroke-width="5"/>`;
		lines.forEach(
			(l, i) => (svg += text(40, 80 + i * 52, 44, l, font, i ? '' : 'font-weight="bold"'))
		);
		svg += text(40, 330, r.int(150, 175), pounds(bigPrice), font, 'font-weight="bold"');
		svg += text(660, 330, 48, bigMark, font, 'font-weight="bold"');
		svg += text(40, 420, 44, `${pounds(smallPrice)} ${smallMark}`, font);
		svg += text(40, 520, 30, unitPrice({ ...p, price: bigPrice }, r), font);
		return {
			svg,
			width: W,
			height: H,
			description: [desc],
			price: bigPrice,
			vat: exBig ? 'ex' : 'inc'
		};
	},
	offer(p, r) {
		const W = 1000;
		const H = 640;
		const font = r.pick(SANS);
		const desc = descriptionText(p, r);
		const lines = twoLines(desc, r, 28);
		const kind = r.pick(['was', 'multibuy', 'loyalty', 'save']);
		const banner = {
			was: 'PRICE DROP',
			multibuy: 'MULTI BUY',
			loyalty: 'CLUBCARD PRICE',
			save: 'SPECIAL OFFER'
		}[kind]!;
		const colour = r.pick(['#d71920', '#00539f', '#e4572e', '#2e7d32']);
		let svg = `<rect width="${W}" height="${H}" fill="#fff"/><rect width="${W}" height="80" fill="${colour}"/>`;
		svg += text(W / 2, 57, 44, banner, font, 'font-weight="bold" fill="#fff" text-anchor="middle"');
		lines.forEach(
			(l, i) => (svg += text(40, 145 + i * 50, 42, l, font, i ? '' : 'font-weight="bold"'))
		);
		const mid = 145 + lines.length * 50 + 30;
		if (kind === 'was') svg += text(40, mid, 40, `Was ${pounds(Math.round(p.price * 1.3))}`, font);
		let offer: Label['offer'];
		if (kind === 'multibuy') {
			offer = { quantity: r.int(2, 3), totalMinor: p.price * 2 - 50 };
			svg += text(40, mid, 40, `Any ${offer.quantity} for ${pounds(offer.totalMinor)}`, font);
		}
		if (kind === 'save') svg += text(40, mid, 40, `Save ${r.int(20, 90)}p`, font);
		if (kind === 'loyalty') {
			// The loyalty price is the big one; the shelf price for everyone is printed smaller.
			const card = Math.round(p.price * 0.8);
			svg += `<rect x="560" y="${mid - 50}" width="400" height="290" rx="20" fill="#ffd400"/>`;
			svg += text(
				760,
				mid - 5,
				32,
				'Clubcard Price',
				font,
				'font-weight="bold" text-anchor="middle"'
			);
			svg += text(
				760,
				mid + 170,
				150,
				pounds(card),
				font,
				'font-weight="bold" text-anchor="middle"'
			);
			svg += text(40, mid + 60, 40, `Regular price`, font);
			svg += text(40, mid + 160, 110, pounds(p.price), font, 'font-weight="bold"');
		} else {
			svg += text(
				W - 40,
				mid + 190,
				r.int(160, 190),
				pounds(p.price),
				font,
				'font-weight="bold" text-anchor="end"'
			);
		}
		svg += text(40, H - 30, 30, unitPrice(p, r), font);
		return { svg, width: W, height: H, description: [desc], price: p.price, vat: null, offer };
	},
	esl(p, r) {
		// Electronic shelf label: grey e-paper, caps name on top, big price with raised pence.
		const W = 1000;
		const H = 560;
		const font = r.pick(['Liberation Sans Narrow', 'Nimbus Sans Narrow', 'Liberation Sans']);
		const desc = descriptionText(p, r, true);
		const whole = Math.floor(p.price / 100);
		const pence = String(p.price % 100).padStart(2, '0');
		let svg = `<rect width="${W}" height="${H}" fill="#e8e8e2"/>`;
		svg += text(
			30,
			70,
			46,
			desc.length > 30 ? desc.slice(0, 30).replace(/\s+\S*$/, '') : desc,
			font,
			'font-weight="bold"'
		);
		const big = r.int(240, 280);
		const x = 600;
		svg += text(x, 360, big, String(whole), font, 'font-weight="bold" text-anchor="end"');
		svg += text(x + 10, 220, Math.round(big * 0.4), pence, font, 'font-weight="bold"');
		svg += text(x + 20, 330, 70, '£', font, 'font-weight="bold"');
		svg += text(
			W - 30,
			520,
			38,
			unitPrice(p, r).replace(' per ', '/'),
			font,
			'font-weight="bold" text-anchor="end"'
		);
		svg += text(30, 440, 30, `${r.int(100000, 999999)}  ${r.int(1000, 9999)}`, 'Liberation Mono');
		svg += barcodeSvg(ean13(r), 30, 470, 2, 50, false);
		const shown = desc.length > 30 ? desc.slice(0, 30).replace(/\s+\S*$/, '') : desc;
		return { svg, width: W, height: H, description: [shown], price: p.price, vat: null };
	},
	pence(p, r) {
		const W = 1000;
		const H = 600;
		const font = r.pick(SANS);
		const price = Math.min(p.price, r.int(25, 99));
		const desc = descriptionText(p, r);
		const lines = twoLines(desc, r, 30);
		let svg = `<rect width="${W}" height="${H}" fill="#fff"/>`;
		lines.forEach(
			(l, i) => (svg += text(40, 80 + i * 56, 46, l, font, i ? '' : 'font-weight="bold"'))
		);
		svg += text(
			W - 60,
			430,
			r.int(220, 260),
			`${price}p`,
			font,
			'font-weight="bold" text-anchor="end"'
		);
		svg += text(40, 550, 34, unitPrice({ ...p, price }, r), font);
		return { svg, width: W, height: H, description: [desc], price, vat: null };
	}
};
const LAYOUTS = Object.keys(layouts);

// ---------------------------------------------------------------------------------------------
// Photo simulation

function svgDoc(label: Label) {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${label.width}" height="${label.height}">${label.svg}</svg>`;
}

function render(label: Label, out: string) {
	const svgPath = out.replace(/\.\w+$/, '.svg');
	writeFileSync(svgPath, svgDoc(label));
	execFileSync('rsvg-convert', ['-o', out, svgPath]);
	rmSync(svgPath);
}

function photograph(
	r: Rng,
	labelPng: string,
	neighbourPng: string | undefined,
	out: string,
	seed: number
) {
	// Canvas sized like a phone photo cropped to the camera guide.
	const W = r.int(900, 1500);
	const H = Math.round(W * r.range(0.55, 0.75));
	const labelW = Math.round(W * r.range(0.72, 0.94));
	const shelf = r.pick([
		'#f28c28',
		'#8a8f8c',
		'#2b2b2b',
		'#e9e9e9',
		'#c62828',
		'#1f4e8c',
		'#6d4c41'
	]);
	const jitter = () => r.range(-0.06, 0.06);
	// Perspective: move the label's corners a little, as when the phone is not square on.
	const lw = labelW;
	const lh = Math.round((labelW * 600) / 1000);
	const corners = [
		[0, 0],
		[lw, 0],
		[lw, lh],
		[0, lh]
	];
	const moved = corners.map(([x, y]) => [x + jitter() * lw, y + jitter() * lh]);
	const distort = corners
		.map((c, i) => `${c[0]},${c[1]} ${moved[i][0].toFixed(1)},${moved[i][1].toFixed(1)}`)
		.join(' ');
	const angle = r.range(-6, 6);
	const x = Math.round((W - lw) / 2 + r.range(-0.04, 0.04) * W);
	const y = Math.round((H - lh) / 2 + r.range(-0.05, 0.05) * H);

	// A shelf edge or display behind the label: flat colour with a little texture.
	const args = [
		'-seed',
		String(seed),
		'-size',
		`${W}x${H}`,
		`xc:${shelf}`,
		'-attenuate',
		'0.4',
		'+noise',
		'Multiplicative',
		'-blur',
		'0x4'
	];
	if (neighbourPng) {
		// Part of the next label along the shelf, cut by the frame edge.
		const left = r.chance(0.5);
		const visible = r.range(0.12, 0.3) * lw;
		const nx = left
			? Math.round(x - lw - r.range(10, 40) + visible)
			: Math.round(x + lw + r.range(10, 40));
		args.push(
			'(',
			neighbourPng,
			'-resize',
			`${lw}x`,
			')',
			'-geometry',
			`+${left ? nx : Math.min(nx, W - Math.round(visible))}+${y}`,
			'-composite'
		);
	}
	args.push(
		'(',
		labelPng,
		'-resize',
		`${lw}x${lh}!`,
		'-alpha',
		'set',
		'-virtual-pixel',
		'transparent',
		'-define',
		'distort:viewport=' +
			`${Math.round(lw * 1.2)}x${Math.round(lh * 1.2)}-${Math.round(lw * 0.1)}-${Math.round(lh * 0.1)}`,
		'-distort',
		'Perspective',
		distort,
		'-background',
		'none',
		'-rotate',
		angle.toFixed(2),
		')',
		'-geometry',
		`+${x - Math.round(lw * 0.1)}+${y - Math.round(lh * 0.1)}`,
		'-composite'
	);
	// Uneven light across the label.
	args.push(
		'(',
		'-size',
		`${W}x${H}`,
		'-define',
		`gradient:angle=${r.int(0, 359)}`,
		`gradient:gray(${r.int(92, 100)}%)-gray(${r.int(55, 85)}%)`,
		')',
		'-compose',
		'multiply',
		'-composite'
	);
	// Glare from the plastic sleeve.
	if (r.chance(0.35)) {
		const gx = r.int(0, W);
		const gy = r.int(0, H);
		args.push(
			'(',
			'-size',
			`${W}x${H}`,
			'xc:black',
			'-fill',
			`gray(${r.int(25, 60)}%)`,
			'-draw',
			`ellipse ${gx},${gy} ${r.int(60, 220)},${r.int(30, 120)} 0,360`,
			'-blur',
			`0x${r.int(20, 50)}`,
			')',
			'-compose',
			'screen',
			'-composite'
		);
	}
	args.push('-compose', 'over');
	const blur = r.chance(0.3) ? 0 : r.range(0.3, 1.8);
	if (blur) args.push('-blur', `0x${blur.toFixed(2)}`);
	if (r.chance(0.15)) args.push('-motion-blur', `0x${r.range(2, 5).toFixed(1)}+${r.int(0, 180)}`);
	args.push('-attenuate', r.range(0.2, 1.2).toFixed(2), '+noise', 'Gaussian');
	args.push('-quality', String(r.int(55, 92)), out);
	execFileSync('magick', args);
}

// ---------------------------------------------------------------------------------------------

function generate(
	set: 'dev' | 'test' | 'holdout',
	count: number,
	products: Product[],
	seedBase: number
) {
	const dir = join(ROOT, set);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const tmp = join(dir, '.tmp');
	mkdirSync(tmp, { recursive: true });
	const expected: Record<string, unknown> = {};
	for (let i = 0; i < count; i++) {
		const seed = seedBase + i;
		const r = rng(seed);
		const layout = LAYOUTS[i % LAYOUTS.length];
		const product = products[Math.floor(r.next() * products.length)];
		const label = layouts[layout](product, r);
		const labelPng = join(tmp, `${i}.png`);
		render(label, labelPng);
		let neighbourPng: string | undefined;
		if (r.chance(0.25)) {
			const other = layouts[r.pick(LAYOUTS)](r.pick(products), r);
			neighbourPng = join(tmp, `${i}-n.png`);
			render(other, neighbourPng);
		}
		const name = `${String(i + 1).padStart(3, '0')}-${layout}.jpg`;
		photograph(r, labelPng, neighbourPng, join(dir, name), seed);
		expected[name] = {
			description: label.description,
			unitPriceMinor: label.price,
			vat: label.vat,
			...(label.offer && { offer: label.offer })
		};
	}
	rmSync(tmp, { recursive: true, force: true });
	writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected, null, '\t') + '\n');
	console.log(`Wrote ${count} ${set} labels to ${dir}`);
}

// Disjoint products: the held-out test set never shows a product the reader was tuned on.
const shuffled = [...PRODUCTS].sort((a, b) => {
	const h = (s: string) => [...s].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 7);
	return h(a.name) - h(b.name);
});
const devProducts = shuffled.filter((_, i) => i % 3 === 0);
const testProducts = shuffled.filter((_, i) => i % 3 !== 0);
if (holdout) {
	generate('holdout', testCount, testProducts, 5_000_000);
} else {
	generate('dev', devCount, devProducts, 1_000);
	generate('test', testCount, testProducts, 900_000);
}
