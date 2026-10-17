// Surfaces: the parts of a page that take comments. Without any declared
// surface, the page itself is one. A host declares surfaces in markup:
//
//   <div data-vc-surface="inbox" data-vc-title="Inbox">        part of the page
//   <iframe data-vc-surface="inbox" data-vc-title="Inbox">      a frame
//   <div data-vc-surface="inbox"> … <iframe data-vc-frame> …     a box holding a frame
//
// Each surface has its own pixels, from its top-left corner, so pins stay put
// however the host zooms, pans or scrolls it: the scale and position come from
// measuring the element on screen against its layout size. The page's pixels
// are the document's, so pins scroll with it. Elements are found in the
// surface's document: the host page, or a same-origin frame's own document.

import { elementsAt, findAnchor, shows, clamp, type Box, type Search } from './target.js';
import type { CommentThread } from '../shared/types.js';

export interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface Surface {
	/** '' for the page. */
	id: string;
	title: string;
	/** Null for the page. */
	element: Element | null;
	/** Where its elements are found, if that document can be read. */
	doc?: Document;
	/** Surface pixels to client pixels: client = origin + surface × scale. */
	origin: { x: number; y: number };
	scale: number;
	/** In surface pixels. */
	size: { width: number; height: number };
	/** The visible part of the surface, in client pixels. */
	clip: Rect;
	/** The visible part of what holds it, in client pixels: where its cards can go. */
	stage: Rect;
	/** The document's client pixels to the host's: client = docOrigin + doc × docScale. */
	docOrigin: { x: number; y: number };
	docScale: number;
	/** Where targets are looked for in the document. */
	search: Search;
	/** A frame that takes pointer events itself, so comment mode needs a layer over it to catch them. */
	catches: boolean;
	/** The host keeps its own drag and pan gestures over this surface in comment mode. */
	passGestures: boolean;
	/** From `data-vc-context`. */
	context: Record<string, string>;
}

export interface DiscoverOptions {
	/** Whether an element belongs to the comment UI. */
	ours: (element: Element) => boolean;
	documentOf?: (surface: Element, frame: HTMLIFrameElement) => Document | undefined;
}

/** The surfaces on the page now, outermost first. */
export function discover(doc: Document, options: DiscoverOptions): Surface[] {
	const view = doc.defaultView!;
	const elements = [...doc.querySelectorAll('[data-vc-surface]')];
	const viewport: Rect = { left: 0, top: 0, right: doc.documentElement.clientWidth, bottom: doc.documentElement.clientHeight };
	const skip = (element: Element) => options.ours(element) || Boolean(element.closest('[data-vc-ignore]'));
	if (!elements.length) {
		const root = doc.scrollingElement ?? doc.documentElement;
		return [{
			id: '',
			title: doc.title,
			element: null,
			doc,
			origin: { x: -view.scrollX, y: -view.scrollY },
			scale: 1,
			size: { width: root.scrollWidth, height: root.scrollHeight },
			clip: viewport,
			stage: viewport,
			docOrigin: { x: 0, y: 0 },
			docScale: 1,
			search: { region: box(viewport), skip },
			catches: false,
			passGestures: false,
			context: {}
		}];
	}
	const styles = new Map<Element, CSSStyleDeclaration>();
	const style = (element: Element) => {
		let value = styles.get(element);
		if (!value) styles.set(element, (value = view.getComputedStyle(element)));
		return value;
	};
	const surfaces: Surface[] = [];
	for (const element of elements) {
		const rect = element.getBoundingClientRect();
		if (rect.width < 1 || rect.height < 1) continue;
		const html = element as HTMLElement;
		const layoutWidth = html.offsetWidth || rect.width;
		const scale = rect.width / layoutWidth;
		const stage = intersect(viewport, clipOf(element, style));
		const frame = (element.localName === 'iframe' ? element : element.querySelector('iframe[data-vc-frame]')) as HTMLIFrameElement | null;
		const surface: Surface = {
			id: element.getAttribute('data-vc-surface') ?? '',
			title: element.getAttribute('data-vc-title') ?? frame?.title ?? element.getAttribute('aria-label') ?? '',
			element,
			origin: { x: rect.left + html.clientLeft * scale, y: rect.top + html.clientTop * scale },
			scale,
			size: { width: html.clientWidth || layoutWidth, height: html.clientHeight || html.offsetHeight || rect.height / scale },
			clip: intersect(stage, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }),
			stage,
			docOrigin: { x: 0, y: 0 },
			docScale: 1,
			search: { region: { x: 0, y: 0, width: 0, height: 0 }, skip },
			catches: false,
			passGestures: Boolean(element.closest('[data-vc-gestures="host"]')),
			context: contextOf(element)
		};
		if (frame) {
			const doc = (options.documentOf ?? frameDocument)(element, frame);
			const r = frame.getBoundingClientRect();
			const docScale = frame.offsetWidth ? r.width / frame.offsetWidth : scale;
			surface.doc = doc;
			surface.docOrigin = { x: r.left + frame.clientLeft * docScale, y: r.top + frame.clientTop * docScale };
			surface.docScale = docScale;
			surface.search = { region: { x: 0, y: 0, width: frame.clientWidth, height: frame.clientHeight }, skip };
			surface.catches = style(frame).pointerEvents !== 'none';
		} else {
			surface.doc = doc;
			surface.search = { region: box(surface.clip), within: element, skip };
		}
		surfaces.push(surface);
	}
	return surfaces;
}

/** A same-origin frame's document once it has loaded, or undefined. */
export function frameDocument(_surface: Element, frame: HTMLIFrameElement): Document | undefined {
	try {
		const doc = frame.contentDocument;
		if (!doc || doc.readyState === 'loading' || doc.URL === 'about:blank') return undefined;
		return doc;
	} catch {
		return undefined;
	}
}

/** The surface under a client point, if a comment can go there. */
export function surfaceAt(surfaces: Surface[], doc: Document, x: number, y: number, ours: (element: Element) => boolean): Surface | undefined {
	const top = elementsAt(doc, x, y, ours)[0];
	if (!top || top.closest('[data-vc-ignore]')) return undefined;
	let found: Surface | undefined;
	for (const surface of surfaces) {
		if (!inside(surface.clip, x, y)) continue;
		if (surface.element && !(surface.element === top || surface.element.contains(top))) continue;
		// The innermost of nested surfaces.
		if (!found || (found.element && surface.element && found.element.contains(surface.element))) found = surface;
	}
	return found;
}

export const toClient = (s: Surface, x: number, y: number) => ({ x: s.origin.x + x * s.scale, y: s.origin.y + y * s.scale });
export const fromClient = (s: Surface, x: number, y: number) => ({ x: (x - s.origin.x) / s.scale, y: (y - s.origin.y) / s.scale });
export const docToClient = (s: Surface, x: number, y: number) => ({ x: s.docOrigin.x + x * s.docScale, y: s.docOrigin.y + y * s.docScale });
export const clientToDoc = (s: Surface, x: number, y: number) => ({ x: (x - s.docOrigin.x) / s.docScale, y: (y - s.docOrigin.y) / s.docScale });

/** A box in the surface's document, in client pixels. */
export function docBoxToClient(s: Surface, b: Box): Rect {
	const a = docToClient(s, b.x, b.y);
	return { left: a.x, top: a.y, right: a.x + b.width * s.docScale, bottom: a.y + b.height * s.docScale };
}

/** A box in the surface's document, in surface pixels. */
export function docBoxToSurface(s: Surface, b: Box): Box {
	const a = docToClient(s, b.x, b.y);
	const p = fromClient(s, a.x, a.y);
	const k = s.docScale / s.scale;
	return { x: p.x, y: p.y, width: b.width * k, height: b.height * k };
}

export interface Spot {
	/** The pin, in client pixels. */
	x: number;
	y: number;
	/** The element under it, if found, and its box in client pixels. */
	element?: Element;
	box?: Rect;
	/** Out of view, or its element is gone. */
	hidden: boolean;
}

/**
 * Where a thread's pin is now. A pin on an element moves with it, at the same
 * share of its width and height, and hides while it is out of view or gone; a
 * free pin, or one whose document cannot be read, stays where it was placed.
 */
export function spotOf(s: Surface, thread: Pick<CommentThread, 'x' | 'y' | 'anchor'>): Spot {
	const free = () => {
		const c = toClient(s, Math.min(thread.x, s.size.width), Math.min(thread.y, s.size.height));
		return { ...c, hidden: !inside(s.clip, c.x, c.y) };
	};
	const { anchor } = thread;
	if (!anchor || !s.doc) return free();
	const element = findAnchor(s.doc, anchor);
	if (!element) return { ...free(), hidden: true };
	const r = element.getBoundingClientRect();
	const b = docBoxToSurface(s, { x: r.left, y: r.top, width: r.width, height: r.height });
	const share = (offset: number, size: number) => (size > 0 ? offset / size : 0);
	const x = b.x + clamp(share(thread.x - anchor.x, anchor.width) * b.width, 1, b.width - 1);
	const y = b.y + clamp(share(thread.y - anchor.y, anchor.height) * b.height, 1, b.height - 1);
	const c = toClient(s, x, y);
	const d = clientToDoc(s, c.x, c.y);
	const box = docBoxToClient(s, { x: r.left, y: r.top, width: r.width, height: r.height });
	const visible = r.width > 0 && r.height > 0 && inside(s.clip, c.x, c.y) && shows(element, d.x, d.y, s.search);
	return { x: c.x, y: c.y, element, box, hidden: !visible };
}

export function inside(r: Rect, x: number, y: number) {
	return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function intersect(a: Rect, b: Rect): Rect {
	return { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
}

const box = (r: Rect): Box => ({ x: r.left, y: r.top, width: Math.max(0, r.right - r.left), height: Math.max(0, r.bottom - r.top) });

/** What clips an element: every ancestor that does not let its overflow show. */
function clipOf(element: Element, style: (element: Element) => CSSStyleDeclaration): Rect {
	let clip: Rect = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
	const body = element.ownerDocument.body;
	for (let node = element.parentElement; node && node !== body; node = node.parentElement) {
		const s = style(node);
		if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
		const r = node.getBoundingClientRect();
		clip = intersect(clip, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
	}
	return clip;
}

function contextOf(element: Element): Record<string, string> {
	const raw = element.getAttribute('data-vc-context');
	if (!raw) return {};
	try {
		const value = JSON.parse(raw);
		if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
		return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' || typeof v === 'number')
			.map(([k, v]) => [k, String(v)]));
	} catch {
		return {};
	}
}
