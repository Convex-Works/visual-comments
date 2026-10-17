// Finds the element a comment pin is meant for, in a document: the host page,
// or a same-origin frame's own document. A frame's elements belong to another
// realm: test them by name, never with instanceof. Everything here is in the
// document's client pixels.

/** A box in a document's client pixels. */
export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** An element a pin can attach to. */
export interface CommentTarget {
	element: Element;
	box: Box;
	/** Corner radius in document pixels, so the highlight takes the element's shape. */
	radius: number;
	/** What it is and what it says, e.g. `button “Add prompts”`. */
	label: string;
}

/** Where to look, and what to pass over. */
export interface Search {
	/** The part of the document that takes comments: a frame's viewport, or a surface's box. */
	region: Box;
	/** Only elements inside this one, for a surface that is part of a page. */
	within?: Element;
	/** Elements that are never targets, with what they contain: the comment UI, host chrome. */
	skip: (element: Element) => boolean;
}

/** How far the pull reaches, in screen pixels. */
export const MAGNET = 14;
/** Elements covering more of the region than this are layout, not something to comment on. */
const LAYOUT_SHARE = 0.6;
/** Controls up to this size take in what they contain, as a button takes its icon and text. */
const COMPACT = { width: 480, height: 56 };

const NAMED = '[data-vc-target],[data-pf-comment]';
const CONTROL =
	'a[href],button,input,select,textarea,label,summary,[contenteditable],[tabindex]:not([tabindex="-1"]),' +
	'[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option],' +
	'[data-vc-interactive],[data-pf-link],[data-pf-interactive]';
const MEDIA = 'img,svg,canvas,video,picture,iframe';
const CONTENT = 'h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,blockquote,pre,figcaption,caption,legend';
const GROUP =
	'section,article,aside,nav,header,footer,form,table,tr,fieldset,dialog,figure,ul,ol,' +
	'[role=region],[role=dialog],[role=row],[role=grid],[role=table],[role=tablist],[role=listitem],' +
	'[role=cell],[role=gridcell],[role=columnheader]';

const SVG = 'http://www.w3.org/2000/svg';
const TRANSPARENT = /^transparent$|,\s*0\)$|\/\s*0\)$/;

/** The elements at a point, top first, without skipped ones. */
export function elementsAt(doc: Document, x: number, y: number, skip: Search['skip']): Element[] {
	return doc.elementsFromPoint(x, y).filter((element) => !skip(element));
}

/**
 * The element nearest the point, or undefined for open space. Under the
 * pointer, the innermost meaningful element wins. A smaller one within
 * `radius` pulls the pointer onto it, as long as it sits inside that element.
 */
export function targetAt(doc: Document, x: number, y: number, radius: number, search: Search): CommentTarget | undefined {
	const scan = new Scan(doc, search);
	const { region } = search;
	const found = new Map<Element, Box>();
	for (const [dx, dy] of probes(radius)) {
		const px = x + dx;
		const py = y + dy;
		if (px < region.x || py < region.y || px >= region.x + region.width || py >= region.y + region.height) continue;
		for (const hit of elementsAt(doc, px, py, search.skip)) {
			const element = scan.target(hit);
			if (element && !found.has(element)) found.set(element, scan.box(element));
		}
	}

	let inner: { element: Element; box: Box } | undefined;
	for (const [element, box] of found) {
		if (distance(box, x, y) === 0 && (!inner || area(box) < area(inner.box))) inner = { element, box };
	}
	let pull: { element: Element; box: Box; gap: number } | undefined;
	for (const [element, box] of found) {
		const gap = distance(box, x, y);
		if (gap === 0 || gap > radius) continue;
		if (inner && !(area(box) < area(inner.box) && inner.element.contains(element))) continue;
		if (!pull || gap < pull.gap || (gap === pull.gap && area(box) < area(pull.box))) pull = { element, box, gap };
	}
	const chosen = pull ?? inner;
	return chosen && scan.describe(chosen.element, chosen.box);
}

/** The meaningful element around this one, for when the pin meant more than it caught. */
export function widen(target: CommentTarget, search: Search): CommentTarget | undefined {
	if (!target.element.ownerDocument.defaultView) return undefined;
	const scan = new Scan(target.element.ownerDocument, search);
	for (let element = target.element.parentElement; element; element = element.parentElement) {
		if (search.within && !search.within.contains(element)) break;
		if (!scan.candidate(element)) continue;
		const box = scan.box(element);
		if (area(box) > area(target.box) * 1.02) return scan.describe(element, box);
	}
	return undefined;
}

/** The element an anchor names in a document, if it is still there and still says the same. */
export function findAnchor(doc: Document, anchor: { selector: string; text: string }): Element | undefined {
	let element: Element | null = null;
	try {
		element = doc.querySelector(anchor.selector);
	} catch {
		return undefined;
	}
	if (!element) return undefined;
	const said = normalize(anchor.text).replace(/…$/, '').slice(0, 40);
	return !said || normalize(visibleText(element)).startsWith(said) ? element : undefined;
}

/**
 * Whether the point of the element shows: inside the region, not clipped by a
 * scrolling container, and not covered (a sticky header).
 */
export function shows(element: Element, x: number, y: number, search: Search): boolean {
	const { region } = search;
	if (x < region.x || y < region.y || x >= region.x + region.width || y >= region.y + region.height) return false;
	if (clipped(element, x, y)) return false;
	const top = elementsAt(element.ownerDocument, x, y, search.skip)[0];
	// The element itself may not take pointer events (a chart), so its container counts as showing it.
	return Boolean(top && (top === element || element.contains(top) || top.contains(element)));
}

/** Scrolls the document's containers until the element is in the middle of them. */
export function reveal(element: Element) {
	const view = element.ownerDocument.defaultView;
	if (!view) return;
	for (let node = element.parentElement; node; node = node.parentElement) {
		const style = view.getComputedStyle(node);
		const scrolls = /auto|scroll/.test(style.overflowX + style.overflowY);
		if (!scrolls || node === element.ownerDocument.body) continue;
		const outer = node.getBoundingClientRect();
		const r = element.getBoundingClientRect();
		if (r.top < outer.top || r.bottom > outer.bottom) node.scrollTop += r.top - outer.top - (outer.height - r.height) / 2;
		if (r.left < outer.left || r.right > outer.right) node.scrollLeft += r.left - outer.left - (outer.width - r.width) / 2;
	}
	const r = element.getBoundingClientRect();
	if (r.top < 0 || r.bottom > view.innerHeight) view.scrollBy(0, r.top - (view.innerHeight - r.height) / 2);
}

/** The scrolling container from this element up that can still scroll, to pass wheel turns to. */
export function scrollerFrom(start: Element | null, dx: number, dy: number): Element | undefined {
	const view = start?.ownerDocument.defaultView;
	if (!view) return undefined;
	for (let node: Element | null = start; node; node = node.parentElement) {
		const style = view.getComputedStyle(node);
		const root = node === node.ownerDocument.scrollingElement;
		const canY = (root || /auto|scroll/.test(style.overflowY)) && node.scrollHeight > node.clientHeight
			&& (dy < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1);
		const canX = (root || /auto|scroll/.test(style.overflowX)) && node.scrollWidth > node.clientWidth
			&& (dx < 0 ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
		if ((dy && canY) || (dx && canX)) return node;
	}
	return undefined;
}

/** Whether a container that clips its overflow hides this point of the element. */
function clipped(element: Element, x: number, y: number) {
	const view = element.ownerDocument.defaultView!;
	for (let node = element.parentElement; node && node !== element.ownerDocument.body; node = node.parentElement) {
		const style = view.getComputedStyle(node);
		if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
		const r = node.getBoundingClientRect();
		if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true;
	}
	return false;
}

/** What a thread stores about its target: a selector, its label and text. */
export function describeTarget(target: CommentTarget) {
	return {
		selector: selectorOf(target.element),
		label: target.label,
		text: shorten(visibleText(target.element), 300)
	};
}

/** One pass over a document, remembering what it has measured. */
class Scan {
	private view: Window;
	private search: Search;
	private ranks = new Map<Element, number>();

	constructor(doc: Document, search: Search) {
		this.view = doc.defaultView!;
		this.search = search;
	}

	/** The visible part of an element's box, within the region. */
	box(element: Element): Box {
		const r = element.getBoundingClientRect();
		const { region } = this.search;
		const x = Math.max(r.left, region.x);
		const y = Math.max(r.top, region.y);
		return {
			x,
			y,
			width: Math.max(Math.min(r.right, region.x + region.width) - x, 0),
			height: Math.max(Math.min(r.bottom, region.y + region.height) - y, 0)
		};
	}

	/**
	 * How much an element means on its own: 0 for wrappers and layout, then
	 * groups and boxes, content, controls and media, and elements the page
	 * names with `data-vc-target`.
	 */
	rank(element: Element): number {
		let rank = this.ranks.get(element);
		if (rank === undefined) {
			rank = this.measure(element);
			this.ranks.set(element, rank);
		}
		return rank;
	}

	private measure(element: Element): number {
		const name = element.localName;
		if (name === 'html' || name === 'body' || name === 'head') return 0;
		const { within, region, skip } = this.search;
		if (within && (element === within || !within.contains(element))) return 0;
		if (skip(element)) return 0;
		// Paths and groups inside an SVG belong to the SVG.
		if (element.namespaceURI === SVG && (name !== 'svg' || element.parentElement?.closest('svg'))) return 0;
		const r = element.getBoundingClientRect();
		if (r.width < 2 || r.height < 2) return 0;
		const style = this.view.getComputedStyle(element);
		if (style.visibility !== 'visible' || style.opacity === '0') return 0;
		if (element.matches(NAMED)) return 5;
		if (r.width * r.height > region.width * region.height * LAYOUT_SHARE) return 0;
		if (element.matches(CONTROL) || element.matches(MEDIA)) return 4;
		if (element.matches(CONTENT) || ownText(element)) return 3;
		if (element.matches(GROUP) || boxed(style)) return 2;
		return 0;
	}

	candidate(element: Element) {
		return this.rank(element) > 0;
	}

	/** The element a hit stands for: its nearest meaningful ancestor, taken in by a compact control. */
	target(hit: Element): Element | undefined {
		let element: Element | null = hit;
		while (element && !this.candidate(element)) element = element.parentElement;
		if (!element) return undefined;
		const control = element.parentElement?.closest(CONTROL);
		if (control && this.candidate(control)) {
			const r = control.getBoundingClientRect();
			if (r.width <= COMPACT.width && r.height <= COMPACT.height) element = control;
		}
		// A wrapper the same size as what it wraps is the same thing; keep the one that means more.
		for (let parent = element.parentElement; parent && sameBox(parent, element); parent = parent.parentElement) {
			if (this.rank(parent) < this.rank(element)) break;
			element = parent;
		}
		return element;
	}

	describe(element: Element, box: Box): CommentTarget {
		const radius = parseFloat(this.view.getComputedStyle(element).borderTopLeftRadius) || 0;
		return { element, box, radius: Math.min(radius, box.width / 2, box.height / 2), label: labelOf(element) };
	}
}

function labelOf(element: Element): string {
	const name =
		element.getAttribute('data-vc-target') ||
		element.getAttribute('data-pf-comment') ||
		element.getAttribute('aria-label') ||
		element.getAttribute('alt') ||
		element.getAttribute('title') ||
		element.getAttribute('placeholder') ||
		visibleText(element) ||
		// A label or wrapper around a field is named by the field.
		element.querySelector('input,textarea,select')?.getAttribute('placeholder') ||
		element.querySelector('input,textarea,select')?.getAttribute('aria-label');
	const label = name ? `${kindOf(element)} “${shorten(name, 60)}”` : kindOf(element);
	const column = columnOf(element);
	return column ? `${label} in “${shorten(column, 40)}”` : label;
}

/** A table cell's column heading, so a bare number says what it counts. */
function columnOf(element: Element): string | undefined {
	if (element.localName !== 'td') return undefined;
	const index = [...(element.parentElement?.children ?? [])].indexOf(element);
	const head = element.closest('table')?.querySelector('thead tr')?.children[index];
	return head ? visibleText(head) || undefined : undefined;
}

const ROLES: Record<string, string> = {
	button: 'button', link: 'link', tab: 'tab', menuitem: 'menu item', checkbox: 'checkbox',
	switch: 'switch', option: 'option', row: 'row', cell: 'cell', gridcell: 'cell',
	columnheader: 'column header', listitem: 'list item', region: 'region', dialog: 'dialog',
	tablist: 'tabs', grid: 'table', table: 'table', img: 'image'
};
const TAGS: Record<string, string> = {
	a: 'link', button: 'button', select: 'menu', textarea: 'field', label: 'label', summary: 'button',
	img: 'image', picture: 'image', svg: 'graphic', canvas: 'graphic', video: 'video', iframe: 'embed',
	h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
	p: 'text', li: 'list item', td: 'cell', th: 'column header', tr: 'row', table: 'table',
	ul: 'list', ol: 'list', nav: 'navigation', header: 'header', footer: 'footer', aside: 'sidebar',
	section: 'section', article: 'article', form: 'form', dialog: 'dialog', figure: 'figure',
	blockquote: 'quote', pre: 'code', caption: 'caption', figcaption: 'caption', legend: 'legend'
};

/** Tags that say more than a role a page gives them, e.g. a table row that is also a link. */
const STRUCTURE = new Set(['tr', 'td', 'th', 'li']);

function kindOf(element: Element): string {
	if (STRUCTURE.has(element.localName)) return TAGS[element.localName];
	const role = ROLES[element.getAttribute('role') ?? ''];
	if (role) return role;
	if (element.localName === 'input') {
		const type = element.getAttribute('type') ?? 'text';
		return type === 'checkbox' || type === 'radio' ? type : type === 'button' || type === 'submit' ? 'button' : 'field';
	}
	return TAGS[element.localName] ?? (ownText(element) ? 'text' : 'box');
}

/**
 * A short path to the element: from the nearest ancestor with an id, or one
 * the page names with `data-vc-target` or `data-testid`, by tag and position.
 */
function selectorOf(element: Element): string {
	const parts: string[] = [];
	for (let node: Element | null = element; node && node.localName !== 'html'; node = node.parentElement) {
		if (node.id) {
			parts.unshift(`#${CSS.escape(node.id)}`);
			break;
		}
		const named = ['data-vc-target', 'data-testid'].find((name) => node!.hasAttribute(name));
		if (named) {
			const selector = `[${named}="${CSS.escape(node.getAttribute(named)!)}"]`;
			if (node.ownerDocument.querySelectorAll(selector).length === 1) {
				parts.unshift(selector);
				break;
			}
		}
		let part = node.localName;
		const twins = node.parentElement
			? [...node.parentElement.children].filter((child) => child.localName === node!.localName)
			: [];
		if (twins.length > 1) part += `:nth-of-type(${twins.indexOf(node) + 1})`;
		parts.unshift(part);
	}
	return parts.join(' > ');
}

function visibleText(element: Element): string {
	const text = (element as HTMLElement).innerText ?? element.textContent ?? '';
	return text.replace(/\s+/g, ' ').trim();
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

function ownText(element: Element) {
	for (const node of element.childNodes) if (node.nodeType === 3 && node.textContent?.trim()) return true;
	return false;
}

function boxed(style: CSSStyleDeclaration) {
	if (!TRANSPARENT.test(style.backgroundColor) || style.backgroundImage !== 'none' || style.boxShadow !== 'none') return true;
	return (['Top', 'Right', 'Bottom', 'Left'] as const).some(
		(side) => parseFloat(style[`border${side}Width`]) > 0 && !TRANSPARENT.test(style[`border${side}Color`])
	);
}

function sameBox(a: Element, b: Element) {
	const r = a.getBoundingClientRect();
	const s = b.getBoundingClientRect();
	return Math.abs(r.left - s.left) < 1 && Math.abs(r.top - s.top) < 1
		&& Math.abs(r.right - s.right) < 1 && Math.abs(r.bottom - s.bottom) < 1;
}

/** The pointer, then rings around it, so nearby elements are found as well as the one under it. */
function probes(radius: number): [number, number][] {
	const points: [number, number][] = [[0, 0]];
	for (const [reach, count] of [[radius / 2, 4], [radius, 8]] as const) {
		for (let i = 0; i < count; i++) {
			const angle = (i / count) * Math.PI * 2 + (count === 4 ? Math.PI / 4 : 0);
			points.push([Math.cos(angle) * reach, Math.sin(angle) * reach]);
		}
	}
	return points;
}

function distance(box: Box, x: number, y: number) {
	const dx = Math.max(box.x - x, 0, x - (box.x + box.width));
	const dy = Math.max(box.y - y, 0, y - (box.y + box.height));
	return Math.hypot(dx, dy);
}

const area = (box: Box) => box.width * box.height;
export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
export const shorten = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
