import { mount, unmount, untrack } from 'svelte';
import { aimAt, type Aim } from './core/aim.js';
import { Api } from './core/api.js';
import { discover, inside, surfaceAt, toClient, type Rect, type Surface } from './core/surfaces.js';
import { reveal, scrollerFrom, type CommentTarget } from './core/target.js';
import { Threads } from './core/threads.svelte.js';
import App from './ui/App.svelte';
import Account from './ui/Account.svelte';
import { properties, styles } from './ui/generated/styles.js';
import type { CommentImage, CommentThread } from './shared/types.js';

export interface VisualCommentsOptions {
	/** Where the site's server passes comment requests on to the comment server. Default `/_comments`. */
	endpoint?: string;
	/**
	 * The site's sign-in: the path of its routes, as in `@convex-works/sign-in`
	 * (default `/auth`), or functions that sign in and out.
	 */
	auth?: string | { signIn(): void; signOut(): void };
	/**
	 * The page threads belong to. Default: the address's origin and path, so
	 * the query and fragment do not matter. A fixed string makes every page share threads.
	 */
	page?: string | ((url: URL) => string);
	/** What to store about where a thread is placed, besides the viewport size and `data-vc-context`. */
	context?: (surface: SurfaceInfo) => Record<string, string | number | undefined> | undefined;
	/**
	 * Brings a thread's surface into view when it is opened from the list or a
	 * link, e.g. by zooming a canvas to it or navigating to it. Return true when
	 * handled; otherwise threads on other pages are opened by navigating to them.
	 */
	show?: (thread: CommentThread) => boolean | void;
	/** The address that opens a thread. Default: where it was placed, with `#vc=<id>`. */
	link?: (thread: CommentThread) => string;
	/** A surface's title and place in the list, for surfaces not on screen. */
	describe?: (surface: string) => { title?: string; order?: number } | undefined;
	/** A frame surface's document, when the default (any same-origin frame once loaded) is not right. */
	documentOf?: (surface: Element, frame: HTMLIFrameElement) => Document | undefined;
	/** The key that turns comment mode on and off. Default: `c`. */
	shortcut?: string | false;
	/** Show the floating toolbar. Default: unless the page has a `[data-vc-toggle]` button. */
	toolbar?: boolean;
}

export interface SurfaceInfo {
	id: string;
	title: string;
	element: Element | null;
}

export interface CommentFilters {
	query: string;
	sort: 'date' | 'place';
	showResolved: boolean;
	onlyMine: boolean;
	/** Threads on every page, not only this one. */
	allPages: boolean;
}

/** A new comment being written. */
export interface Draft extends Aim {
	text: string;
	/** Narrower targets the pin was widened from, innermost first. */
	inner?: CommentTarget[];
	/** Images added so far, so a click elsewhere keeps them like text. */
	images?: number;
}

interface Pointer {
	x: number;
	y: number;
	alt: boolean;
}

/** Pointer moves under this many pixels between press and release still count as a click. */
const DRAG = 4;

/**
 * Comments on a page: pins, the comment mode, the list of threads and the
 * sign-in, drawn in a shadow root over the page. One per page.
 */
export class VisualComments {
	readonly api: Api;
	readonly store: Threads;
	options = $state.raw<VisualCommentsOptions>() as VisualCommentsOptions;

	/** Comment mode: the list is shown, and clicking a surface starts a thread. Pins always show. */
	active = $state(false);
	/** The thread whose conversation is open. */
	openId = $state<number | undefined>();
	draft = $state<Draft | undefined>();
	filters = $state<CommentFilters>({ query: '', sort: 'date', showResolved: false, onlyMine: false, allPages: false });

	/** Measured on every change of the page. */
	surfaces = $state.raw<Surface[]>([]);
	/** Bumped whenever anything on the page may have moved. */
	layout = $state(0);
	page = $state('');
	/** Where the host asked for the list to go. */
	panelRect = $state.raw<Rect | undefined>();
	hostToggles = $state(false);

	/** Where a click would start a thread, while it would. */
	aim = $state.raw<Aim | undefined>();
	/** The pointer while it is over a surface in comment mode: the comment cursor is drawn there. */
	cursor = $state.raw<{ x: number; y: number } | undefined>();
	/** Opening a thread scrolls its element into view once it is found. */
	revealing = $state<number | undefined>();

	readonly doc: Document;
	readonly host: HTMLElement;
	private app?: ReturnType<typeof mount>;
	private slots = new Map<Element, ReturnType<typeof mount>>();
	private frames = new Map<Document, () => void>();
	private cleanup: (() => void)[] = [];
	private pointer?: Pointer;
	private pressed?: { x: number; y: number };
	private measuring = 0;
	private aiming = 0;
	private animating = 0;
	private cursorSheet = new CSSStyleSheet();
	private focusDraftHandler?: () => void;
	private linked?: number;

	constructor(options: VisualCommentsOptions, doc: Document = document) {
		this.options = options;
		this.doc = doc;
		this.api = new Api(options.endpoint ?? '/_comments');
		this.store = new Threads(this.api);
		this.host = doc.createElement('visual-comments');
		this.host.setAttribute('data-vc-ignore', '');
		this.host.style.cssText = 'position:fixed;inset:0;z-index:2147483600;pointer-events:none;display:block;';
		this.start();
	}

	// State for the UI and hosts.

	get viewer() { return this.store.viewer; }
	get threads() { return this.store.threads; }
	get unreadCount() { return this.store.unreadCount; }
	get loading() { return this.store.loading; }
	get open(): CommentThread | undefined {
		return this.store.threads.find((thread) => thread.id === this.openId);
	}

	/** Threads shown as pins: on this page, unresolved unless resolved ones are shown or it is open. */
	get pinned(): CommentThread[] {
		return this.store.threads.filter((thread) => thread.page === this.page
			&& (!thread.resolvedAt || this.filters.showResolved || thread.id === this.openId));
	}

	get showToolbar() {
		return this.options.toolbar ?? !this.hostToggles;
	}

	surface(id: string): Surface | undefined {
		return this.surfaces.find((surface) => surface.id === id);
	}

	/** A surface's title for the list, whether or not it is on screen. */
	titleOf(thread: CommentThread): string {
		return this.surface(thread.surface)?.title || this.options.describe?.(thread.surface)?.title || thread.title
			|| new URL(thread.url).pathname;
	}

	orderOf(thread: CommentThread): number {
		return this.options.describe?.(thread.surface)?.order
			?? this.surfaces.findIndex((surface) => surface.id === thread.surface);
	}

	linkOf(thread: CommentThread): string {
		return this.options.link?.(thread) ?? `${thread.url}#vc=${thread.id}`;
	}

	imageUrl(image: CommentImage) {
		return this.store.imageUrl(image);
	}

	/** Whether an element belongs to the comment UI. */
	readonly ours = (element: Element) => element === this.host || this.slots.has(element);

	// Actions.

	/** Changes options after creation, e.g. when a host's view mounts and can show threads. */
	configure(options: Partial<VisualCommentsOptions>) {
		// Hosts call this from their own effects, which must not depend on the options.
		this.options = { ...untrack(() => this.options), ...options };
		this.schedule();
	}

	toggle(on = !this.active) {
		this.active = on;
		this.cursor = undefined;
		this.aim = undefined;
		if (!on) {
			this.draft = undefined;
			this.openId = undefined;
		}
		this.updateCursorStyle();
		this.updateAim();
	}

	openThread(id: number | undefined) {
		this.openId = id;
		const thread = this.open;
		if (thread?.unread) void this.store.markRead(thread.id, true);
	}

	/** Opens a thread from the list or a link, bringing it into view. */
	focus(thread: CommentThread) {
		this.draft = undefined;
		this.active = true;
		this.openThread(thread.id);
		this.revealing = thread.id;
		if (this.options.show?.(thread)) return;
		if (thread.page !== this.page) {
			location.assign(this.linkOf(thread));
			return;
		}
		const surface = this.surface(thread.surface);
		if (!surface) return;
		if (surface.element) {
			const { clip } = surface;
			if (clip.right - clip.left < 80 || clip.bottom - clip.top < 80) surface.element.scrollIntoView({ block: 'center', inline: 'center' });
		} else if (!thread.anchor) {
			const at = toClient(surface, thread.x, thread.y);
			if (!inside(surface.clip, at.x, at.y)) window.scrollTo({ top: thread.y - innerHeight / 3, behavior: 'smooth' });
		}
	}

	/** The thread's element, once found, scrolled into view inside its document. */
	revealElement(element: Element) {
		reveal(element);
		this.revealing = undefined;
	}

	/** Leaves for the site's sign-in, and comes back to this address. */
	signIn() {
		const auth = this.options.auth ?? '/auth';
		if (typeof auth === 'object') return auth.signIn();
		const returnTo = `${location.pathname}${location.search}${location.hash}`;
		location.assign(`${auth.replace(/\/$/, '')}/login?${new URLSearchParams({ returnTo })}`);
	}

	signOut() {
		this.toggle(false);
		const auth = this.options.auth ?? '/auth';
		if (typeof auth === 'object') return auth.signOut();
		// A form, so the site's server can send the browser on to the identity provider.
		const form = this.doc.createElement('form');
		form.method = 'POST';
		form.action = `${auth.replace(/\/$/, '')}/logout`;
		form.hidden = true;
		this.doc.body.appendChild(form);
		form.submit();
	}

	/** Measures the page again, e.g. after the host moved surfaces in a way it cannot see. */
	relayout() {
		this.schedule();
	}

	/** For hosts that are not built with Svelte: called after any change of state. */
	subscribe(listener: (comments: VisualComments) => void): () => void {
		return $effect.root(() => {
			$effect(() => {
				void [this.active, this.openId, this.unreadCount, this.viewer, this.store.threads.length, this.loading];
				listener(this);
			});
		});
	}

	destroy() {
		for (const stop of this.cleanup.splice(0)) stop();
		for (const stop of this.frames.values()) stop();
		this.frames.clear();
		for (const app of this.slots.values()) void unmount(app);
		this.slots.clear();
		if (this.app) void unmount(this.app);
		this.host.remove();
		this.doc.adoptedStyleSheets = this.doc.adoptedStyleSheets.filter((sheet) => sheet !== this.cursorSheet);
	}

	/** Called by the UI so a click elsewhere can bring the unsent comment back to attention. */
	onFocusDraft(handler: (() => void) | undefined) {
		this.focusDraftHandler = handler;
	}

	private get draftHasContent() {
		return Boolean(this.draft?.text.trim() || this.draft?.images);
	}

	// Setup.

	private start() {
		const doc = this.doc;
		const view = doc.defaultView!;
		const shadow = this.host.attachShadow({ mode: 'open' });
		addStyles(shadow);
		addProperties(doc);
		doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, this.cursorSheet];
		doc.documentElement.appendChild(this.host);
		this.app = mount(App, { target: shadow, props: { vc: this } });

		this.cleanup.push(this.store.start());
		const hash = /(?:^#|&)vc=(\d+)/.exec(location.hash);
		if (hash) {
			this.linked = Number(hash[1]);
			const rest = location.hash.slice(1).split('&').filter((part) => !part.startsWith('vc=')).join('&');
			history.replaceState(history.state, '', `${location.pathname}${location.search}${rest ? `#${rest}` : ''}`);
		}
		this.cleanup.push($effect.root(() => {
			// Open a linked thread once threads have loaded.
			$effect(() => {
				if (this.linked === undefined || this.store.loading) return;
				const thread = this.store.threads.find((t) => t.id === this.linked);
				if (!thread && !this.viewer) return;
				this.linked = undefined;
				if (thread) {
					this.filters.showResolved ||= Boolean(thread.resolvedAt);
					this.focus(thread);
				}
			});
			// Buttons the host marked with data-vc-toggle say whether comment mode is on and if anything is unread.
			$effect(() => {
				const unread = this.unreadCount > 0 && !this.active;
				const pressed = String(this.active);
				void this.layout;
				for (const button of doc.querySelectorAll('[data-vc-toggle]')) {
					if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
					if (button.hasAttribute('data-vc-unread') !== unread) button.toggleAttribute('data-vc-unread', unread);
				}
			});
		}));

		const on = <K extends keyof WindowEventMap>(target: Window | Document, type: K, listener: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions) => {
			target.addEventListener(type, listener as EventListener, options);
			this.cleanup.push(() => target.removeEventListener(type, listener as EventListener, options));
		};
		const capture = { capture: true };
		on(view, 'pointermove', (event) => this.onPointerMove(event), { capture: true, passive: true });
		on(view, 'pointerdown', (event) => this.onPress(event), capture);
		on(view, 'mousedown', (event) => this.onPress(event), capture);
		on(view, 'pointerup', (event) => this.onRelease(event), capture);
		on(view, 'mouseup', (event) => this.onRelease(event), capture);
		on(view, 'click', (event) => this.onClick(event), capture);
		for (const type of ['dblclick', 'auxclick', 'contextmenu'] as const) on(view, type, (event) => this.onOtherClick(event), capture);
		on(view, 'keydown', (event) => this.onKey(event));
		on(view, 'keyup', (event) => this.onKey(event));
		on(view, 'resize', () => this.schedule());
		on(doc, 'scroll', () => this.schedule(), { capture: true, passive: true });
		const leave = () => this.move(undefined);
		doc.documentElement.addEventListener('pointerleave', leave);
		this.cleanup.push(() => doc.documentElement.removeEventListener('pointerleave', leave));
		on(view, 'blur', () => this.move(undefined));
		// An image dropped anywhere but a comment field would make the browser open it.
		const nodrop = (event: DragEvent) => {
			if (this.active && event.dataTransfer?.types.includes('Files') && !event.composedPath().includes(this.host)) event.preventDefault();
		};
		on(view, 'dragover', nodrop);
		on(view, 'drop', nodrop);
		// While CSS transitions and animations run, things move without any change to observe.
		for (const type of ['transitionrun', 'animationstart'] as const) on(doc, type, () => { this.animating++; this.schedule(); }, capture);
		for (const type of ['transitionend', 'transitioncancel', 'animationend', 'animationcancel'] as const) {
			on(doc, type, () => { this.animating = Math.max(0, this.animating - 1); this.schedule(); }, capture);
		}
		const observer = new MutationObserver(() => this.schedule());
		observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
		this.cleanup.push(() => observer.disconnect());
		// Catches what nothing announces, such as a navigation that only changed the address.
		const timer = setInterval(() => { this.animating = 0; this.schedule(); }, 1000);
		this.cleanup.push(() => clearInterval(timer));
		this.measure();
	}

	/** Watches a frame's own document: its scrolling, its changes and its keys. */
	private watchFrame(frame: Document) {
		const view = frame.defaultView;
		if (!view || this.frames.has(frame)) return;
		const schedule = () => this.schedule();
		const key = (event: KeyboardEvent) => this.onKey(event);
		const observer = new MutationObserver(schedule);
		observer.observe(frame.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
		frame.addEventListener('scroll', schedule, { capture: true, passive: true });
		view.addEventListener('resize', schedule);
		view.addEventListener('keydown', key);
		view.addEventListener('keyup', key);
		this.frames.set(frame, () => {
			observer.disconnect();
			frame.removeEventListener('scroll', schedule, { capture: true });
			view.removeEventListener('resize', schedule);
			view.removeEventListener('keydown', key);
			view.removeEventListener('keyup', key);
		});
	}

	// Measuring.

	private schedule() {
		if (this.measuring) return;
		this.measuring = requestAnimationFrame(() => {
			this.measuring = 0;
			this.measure();
			if (this.animating) this.schedule();
		});
	}

	private measure() {
		const doc = this.doc;
		this.surfaces = discover(doc, { ours: this.ours, documentOf: this.options.documentOf });
		this.page = pageOf(this.options.page);
		// A new comment on a surface that has gone, like a frame the viewer left, goes with it.
		if (this.draft && !this.surface(this.draft.surface)) this.draft = undefined;

		const docs = new Set(this.surfaces.map((surface) => surface.doc).filter((d): d is Document => Boolean(d) && d !== doc));
		for (const frame of docs) this.watchFrame(frame);
		for (const [frame, stop] of this.frames) {
			if (!docs.has(frame)) {
				stop();
				this.frames.delete(frame);
			}
		}

		const panel = doc.querySelector('[data-vc-panel]')?.getBoundingClientRect();
		const rect = panel && panel.width > 0 && panel.height > 0
			? { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom }
			: undefined;
		if (rect?.left !== this.panelRect?.left || rect?.top !== this.panelRect?.top
			|| rect?.right !== this.panelRect?.right || rect?.bottom !== this.panelRect?.bottom) this.panelRect = rect;
		this.hostToggles = Boolean(doc.querySelector('[data-vc-toggle]'));
		this.mountSlots();
		this.layout++;
		this.updateAim();
	}

	/** Puts the account button in every `[data-vc-account]` element of the host's own toolbar. */
	private mountSlots() {
		for (const element of this.doc.querySelectorAll('[data-vc-account]')) {
			if (this.slots.has(element) || element.shadowRoot) continue;
			const shadow = element.attachShadow({ mode: 'open' });
			addStyles(shadow);
			this.slots.set(element, mount(Account, { target: shadow, props: { vc: this, slot: true } }));
		}
		for (const [element, app] of this.slots) {
			if (!element.isConnected) {
				void unmount(app);
				this.slots.delete(element);
			}
		}
	}

	// Pointer.

	private fromUs(event: Event) {
		return event.composedPath().includes(this.host);
	}

	private surfaceAt(x: number, y: number) {
		return surfaceAt(this.surfaces, this.doc, x, y, this.ours);
	}

	/** The pointer moved, or left (undefined). Also called by the layers over frames. */
	move(pointer: Pointer | undefined) {
		this.pointer = pointer;
		this.updateAim();
	}

	private onPointerMove(event: PointerEvent) {
		if (!this.active) return;
		if (this.fromUs(event)) return this.move(undefined);
		this.move({ x: event.clientX, y: event.clientY, alt: event.altKey });
	}

	/** Aims again, at most once per frame: the pointer moved, or the page moved under it. */
	private updateAim() {
		if (this.aiming) return;
		this.aiming = requestAnimationFrame(() => {
			this.aiming = 0;
			const pointer = this.pointer;
			const surface = this.active && pointer ? this.surfaceAt(pointer.x, pointer.y) : undefined;
			const cursor = surface && pointer ? { x: pointer.x, y: pointer.y } : undefined;
			this.cursor = cursor;
			this.aim = surface && pointer && !this.draft && this.openId === undefined
				? aimAt(surface, pointer.x, pointer.y, pointer.alt)
				: undefined;
			this.updateCursorStyle();
		});
	}

	/** Over a surface in comment mode the page's cursor is hidden; the comment cursor is drawn instead. */
	private updateCursorStyle() {
		const rule = this.active && this.cursor ? '*, *::before, *::after { cursor: none !important; }' : '';
		if (this.cursorSheet.cssRules.length !== (rule ? 1 : 0)) this.cursorSheet.replaceSync(rule);
	}

	/** Pressing on a surface in comment mode does not reach the page, unless the host keeps its gestures there. */
	private onPress(event: MouseEvent) {
		if (!this.active || this.fromUs(event)) return;
		this.pressed = { x: event.clientX, y: event.clientY };
		const surface = this.surfaceAt(event.clientX, event.clientY);
		if (surface && !surface.passGestures) stop(event);
	}

	private onRelease(event: MouseEvent) {
		if (!this.active || this.fromUs(event)) return;
		const surface = this.surfaceAt(event.clientX, event.clientY);
		if (surface && !surface.passGestures) stop(event);
	}

	private onOtherClick(event: MouseEvent) {
		if (!this.active || this.fromUs(event)) return;
		if (this.surfaceAt(event.clientX, event.clientY)) stop(event);
	}

	private onClick(event: MouseEvent) {
		const path = event.composedPath();
		if (path.some((node) => node instanceof Element && node.matches('[data-vc-toggle]'))) {
			this.toggle();
			return;
		}
		if (this.fromUs(event)) return;
		if (!this.active) {
			// Pins show outside comment mode too; a click away closes the thread one opened.
			if (this.openId !== undefined) this.openThread(undefined);
			return;
		}
		const surface = this.surfaceAt(event.clientX, event.clientY);
		if (!surface) {
			// A click away from the comment: keep an unsent one, drop an empty one, close an open thread.
			if (this.draftHasContent) this.focusDraftHandler?.();
			else if (this.draft) this.draft = undefined;
			else if (this.openId !== undefined) this.openThread(undefined);
			return;
		}
		stop(event);
		const pressed = this.pressed;
		this.pressed = undefined;
		if (pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > DRAG) return;
		this.place(surface, event.clientX, event.clientY, event.altKey);
	}

	/** A click on a surface in comment mode starts a thread. A click away from an open thread closes it first. */
	place(surface: Surface, x: number, y: number, free: boolean) {
		if (this.draftHasContent) {
			this.focusDraftHandler?.();
			return;
		}
		if (this.openId !== undefined) {
			this.openThread(undefined);
			return;
		}
		this.draft = { ...aimAt(surface, x, y, free), text: '' };
		this.updateAim();
	}

	/** A layer over a frame passes wheel turns to whatever scrolls under the pointer. */
	wheel(surface: Surface, event: WheelEvent) {
		const unit = event.deltaMode === 1 ? 16 : 1;
		const dx = event.deltaX * unit;
		const dy = event.deltaY * unit;
		if (surface.doc && surface.doc !== this.doc) {
			const d = { x: (event.clientX - surface.docOrigin.x) / surface.docScale, y: (event.clientY - surface.docOrigin.y) / surface.docScale };
			const scroller = scrollerFrom(surface.doc.elementFromPoint(d.x, d.y), dx / surface.docScale, dy / surface.docScale);
			if (scroller) {
				event.preventDefault();
				scroller.scrollBy(dx / surface.docScale, dy / surface.docScale);
				return;
			}
		}
		const outer = scrollerFrom(surface.element?.parentElement ?? null, dx, dy);
		if (outer) {
			event.preventDefault();
			outer.scrollBy(dx, dy);
		}
	}

	private onKey(event: KeyboardEvent) {
		if (event.key === 'Alt' && this.pointer) {
			this.pointer = { ...this.pointer, alt: event.type === 'keydown' };
			this.updateAim();
			return;
		}
		if (event.type !== 'keydown' || event.defaultPrevented) return;
		const target = event.composedPath()[0] as Element | undefined;
		if (editable(target)) return;
		if (event.key === 'Escape') {
			if (this.host.shadowRoot?.querySelector(':popover-open') || this.doc.querySelector(':popover-open')) return;
			if (this.draft) this.draft = undefined;
			else if (this.openId !== undefined) this.openThread(undefined);
			else if (this.active) this.toggle(false);
			else return;
			event.preventDefault();
			return;
		}
		const shortcut = this.options.shortcut ?? 'c';
		if (shortcut && event.key.toLowerCase() === shortcut && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			this.toggle();
		}
	}
}

function stop(event: Event) {
	event.preventDefault();
	event.stopImmediatePropagation();
}

function editable(target: Element | undefined) {
	const element = target as HTMLElement | undefined;
	return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)));
}

/** The page key: the address's origin and path, without a trailing slash. */
export function pageOf(option: VisualCommentsOptions['page']): string {
	const url = new URL(location.href);
	if (typeof option === 'string') return option;
	if (option) return option(url);
	const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
	return `${url.origin}${path}`;
}

function addStyles(root: ShadowRoot) {
	const style = root.ownerDocument.createElement('style');
	style.textContent = styles;
	root.appendChild(style);
}

/**
 * Custom property registrations only work in the document, not in a shadow
 * root, and the styles' shadows and rings need them. They are the same for
 * every copy of the styles, so they are added once.
 */
const registered = new WeakSet<Document>();
function addProperties(doc: Document) {
	if (registered.has(doc) || !properties) return;
	registered.add(doc);
	const sheet = new CSSStyleSheet();
	sheet.replaceSync(properties);
	doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
}
