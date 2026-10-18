import { CommentError, type CommentStore } from './store.ts';
import { hasSecret, type Space, type Spaces } from './spaces.ts';
import { IMAGE_TYPES, MAX_BODY, MAX_CONTEXT, MAX_CONTEXT_VALUE, MAX_IMAGE_BYTES, MAX_IMAGES } from '../../client/src/lib/shared/limits.ts';
import { USER_HEADER } from '../../client/src/lib/shared/protocol.ts';
import type { CommentAnchor, CommentsSnapshot, Viewer } from '../../client/src/lib/shared/types.ts';

const MAX_IMAGE_SIDE = 20_000;
// Recognised by their first bytes, not by the type the browser claims.
const IMAGE_SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
	'image/png': (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	'image/jpeg': (b) => starts(b, [0xff, 0xd8, 0xff]),
	'image/gif': (b) => starts(b, [0x47, 0x49, 0x46, 0x38]),
	'image/webp': (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50])
};
const MAX_REQUEST = 32 * 1024;
const KEEPALIVE_MS = 25_000;
const noStore = { 'Cache-Control': 'no-store' };

const starts = (bytes: Uint8Array, prefix: number[]) => prefix.every((byte, i) => bytes[i] === byte);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
	return Response.json(data, { status, headers: { ...noStore, ...headers } });
}

const fail = (status: number, error: string) => json({ error }, status);

function text(value: unknown, max: number): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

/** The text of a comment. With `optional`, it may be empty: the comment has images. */
function body(value: unknown, optional = false): string {
	if (typeof value !== 'string' && !(optional && value === undefined)) {
		throw new CommentError(400, 'A comment needs some text or an image.');
	}
	const normalized = (value ?? '').replace(/\r\n?/g, '\n').trim();
	if (!normalized && !optional) throw new CommentError(400, 'A comment needs some text or an image.');
	if (normalized.length > MAX_BODY) throw new CommentError(413, `Comments are limited to ${MAX_BODY} characters.`);
	return normalized;
}

/** Surface pixels. Pins on the page itself are in page pixels, so long pages reach far. */
function coordinate(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
		throw new CommentError(400, 'Invalid comment position.');
	}
	return Math.round(value * 10) / 10;
}

function imageIds(value: unknown): number[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || !value.every((id) => Number.isSafeInteger(id) && id > 0)) {
		throw new CommentError(400, 'Invalid images.');
	}
	const ids = [...new Set(value as number[])];
	if (ids.length > MAX_IMAGES) throw new CommentError(400, `A comment can have up to ${MAX_IMAGES} images.`);
	return ids;
}

function side(value: string | null): number {
	const n = Number(value);
	if (!Number.isInteger(n) || n < 1 || n > MAX_IMAGE_SIDE) throw new CommentError(400, 'Invalid image size.');
	return n;
}

function anchor(value: unknown): CommentAnchor | null {
	if (value === undefined || value === null) return null;
	const input = typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
	const selector = text(input.selector, 1000);
	const label = text(input.label, 200);
	if (!selector || !label) throw new CommentError(400, 'Invalid comment anchor.');
	return {
		selector,
		label,
		text: text(input.text, 500) ?? '',
		x: coordinate(input.x),
		y: coordinate(input.y),
		width: coordinate(input.width),
		height: coordinate(input.height)
	};
}

/** Short text values only: it is shown, not interpreted. */
function context(value: unknown): Record<string, string> {
	if (value === undefined || value === null) return {};
	if (typeof value !== 'object' || Array.isArray(value)) throw new CommentError(400, 'Invalid comment context.');
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([key, item]) => /^[\w.-]{1,40}$/.test(key) && (typeof item === 'string' || typeof item === 'number'))
		.slice(0, MAX_CONTEXT)
		.map(([key, item]) => [key, String(item).slice(0, MAX_CONTEXT_VALUE)]);
	return Object.fromEntries(entries);
}

/** A web address, without its fragment. */
function address(value: unknown): string {
	const raw = text(value, 2048);
	let url: URL;
	try {
		url = new URL(raw ?? '');
	} catch {
		throw new CommentError(400, 'Invalid page address.');
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new CommentError(400, 'Invalid page address.');
	url.hash = '';
	return url.href;
}

async function input(request: Request): Promise<Record<string, unknown>> {
	if (!request.headers.get('content-type')?.includes('application/json')) {
		throw new CommentError(415, 'Send JSON.');
	}
	const raw = await request.text();
	if (raw.length > MAX_REQUEST) throw new CommentError(413, 'Request too large.');
	try {
		const value = JSON.parse(raw);
		if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value;
	} catch { /* fall through */ }
	throw new CommentError(400, 'Invalid request.');
}

function bearer(request: Request): string | undefined {
	return /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
}

/** Who the site says is signed in, or null. The site is trusted: it has the space's secret. */
function viewerOf(request: Request): Viewer | null {
	const raw = request.headers.get(USER_HEADER);
	if (!raw) return null;
	let value: Record<string, unknown>;
	try {
		value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
	} catch {
		throw new CommentError(400, 'Invalid user.');
	}
	const sub = text(value?.sub, 255);
	const name = text(value?.name, 200);
	if (!sub || !name) throw new CommentError(400, 'Invalid user.');
	const email = text(value.email, 320);
	const picture = text(value.picture, 2048);
	return {
		sub,
		name,
		...(email ? { email } : {}),
		...(picture && /^https:\/\//.test(picture) ? { picture } : {})
	};
}

/**
 * The comment endpoints, under `/v1/spaces/<space>`. Only a site's server
 * calls them, with the space's secret and the person signed in on the site;
 * browsers reach them through that server.
 */
export class CommentsApi {
	private store: CommentStore;
	private spaces: Spaces;

	constructor(store: CommentStore, spaces: Spaces) {
		this.store = store;
		this.spaces = spaces;
	}

	async handle(request: Request, url: URL): Promise<Response | undefined> {
		const match = url.pathname.match(/^\/v1\/spaces\/([a-z0-9-]+)(\/.*)?$/);
		if (!match) return undefined;
		const space = this.spaces.get(match[1]);
		// The same answer for an unknown space, so spaces cannot be found by trying.
		if (!space || !hasSecret(space, bearer(request))) return fail(401, 'Unknown space, or the wrong secret.');
		return this.route(request, url, space, (match[2] ?? '').replace(/\/$/, ''));
	}

	private async route(request: Request, url: URL, space: Space, route: string): Promise<Response> {
		const method = request.method;
		try {
			const viewer = viewerOf(request);
			let match: RegExpMatchArray | null;
			if (method === 'GET' && route === '') {
				const snapshot: CommentsSnapshot = {
					space: { id: space.id, name: space.name },
					viewer,
					threads: viewer ? this.store.list(space.id, viewer.sub) : []
				};
				return json(snapshot);
			}
			if (!viewer) return fail(401, 'Sign in to see comments.');
			if (method === 'GET' && route === '/events') return this.events(request, space.id);
			if ((match = route.match(/^\/images\/(\d+)\/([\w-]{8,64})$/)) && method === 'GET') {
				return this.image(space.id, Number(match[1]), match[2]);
			}

			if (route === '/images' && method === 'POST') {
				return json({ image: await this.upload(request, url, space.id, viewer) }, 201);
			}
			if (route === '/threads' && method === 'POST') {
				const data = await input(request);
				const images = imageIds(data.images);
				const thread = this.store.createThread(space.id, viewer, {
					page: text(data.page, 2048) ?? fail400('Unknown page.'),
					url: address(data.url),
					surface: typeof data.surface === 'string' ? data.surface.slice(0, 200) : '',
					title: text(data.title, 200) ?? '',
					x: coordinate(data.x),
					y: coordinate(data.y),
					anchor: anchor(data.anchor),
					context: context(data.context),
					body: body(data.body, images.length > 0),
					images
				});
				return json({ thread }, 201);
			}
			if ((match = route.match(/^\/threads\/(\d+)$/))) {
				const number = Number(match[1]);
				if (method === 'PATCH') {
					const data = await input(request);
					if (typeof data.resolved !== 'boolean') throw new CommentError(400, 'Invalid request.');
					return json({ thread: this.store.resolve(space.id, viewer, number, data.resolved) });
				}
				if (method === 'DELETE') {
					this.store.deleteThread(space.id, viewer, number);
					return json({ deleted: number });
				}
			}
			if ((match = route.match(/^\/threads\/(\d+)\/comments$/)) && method === 'POST') {
				const data = await input(request);
				const images = imageIds(data.images);
				const thread = this.store.reply(space.id, viewer, Number(match[1]), body(data.body, images.length > 0), images);
				return json({ thread }, 201);
			}
			if ((match = route.match(/^\/threads\/(\d+)\/read$/)) && method === 'POST') {
				const data = await input(request);
				if (typeof data.read !== 'boolean') throw new CommentError(400, 'Invalid request.');
				return json({ thread: this.store.markRead(space.id, viewer, Number(match[1]), data.read) });
			}
			if ((match = route.match(/^\/comments\/(\d+)$/))) {
				const id = Number(match[1]);
				if (method === 'PATCH') {
					const data = await input(request);
					// The store checks that a comment left without text still has an image.
					const images = data.images === undefined ? undefined : imageIds(data.images);
					return json({ thread: this.store.editComment(space.id, viewer, id, body(data.body, true), images) });
				}
				if (method === 'DELETE') {
					const thread = this.store.deleteComment(space.id, viewer, id);
					return json(thread ? { thread } : { deleted: id });
				}
			}
			return fail(404, 'Not found.');
		} catch (error) {
			if (error instanceof CommentError) return fail(error.status, error.message);
			console.error('[visual-comments] Comment request failed', error);
			return fail(500, 'Something went wrong. Try again.');
		}
	}

	private image(space: string, id: number, key: string): Response {
		const image = this.store.image(space, id, key);
		return new Response(image.data as Uint8Array<ArrayBuffer>, {
			headers: {
				'Content-Type': image.type,
				// An image's address is never reused, so its bytes never change.
				'Cache-Control': 'private, max-age=31536000, immutable',
				'X-Content-Type-Options': 'nosniff',
				'Content-Security-Policy': "default-src 'none'; sandbox"
			}
		});
	}

	/** An image sent as the raw request body, with `?width=&height=` measured by the browser. */
	private async upload(request: Request, url: URL, space: string, viewer: Viewer) {
		const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
		const matches = IMAGE_TYPES.includes(type) ? IMAGE_SIGNATURES[type] : undefined;
		if (!matches) throw new CommentError(415, 'Images must be PNG, JPEG, GIF or WebP.');
		const tooLarge = `Images are limited to ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`;
		if (Number(request.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new CommentError(413, tooLarge);
		const data = new Uint8Array(await request.arrayBuffer());
		if (data.length > MAX_IMAGE_BYTES) throw new CommentError(413, tooLarge);
		if (!matches(data)) throw new CommentError(415, 'This file is not the image it claims to be.');
		return this.store.addImage(space, viewer, {
			type, width: side(url.searchParams.get('width')), height: side(url.searchParams.get('height')), data
		});
	}

	/** Server-sent events: a `change` event after any write in the space, so clients refetch. */
	private events(request: Request, space: string): Response {
		const encoder = new TextEncoder();
		const store = this.store;
		let cleanup = () => {};
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const send = (chunk: string) => {
					try { controller.enqueue(encoder.encode(chunk)); } catch { cleanup(); }
				};
				const onchange = (event: Event) => {
					if ((event as CustomEvent<string>).detail === space) send('event: change\ndata: {}\n\n');
				};
				const keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS);
				store.events.addEventListener('change', onchange);
				cleanup = () => {
					clearInterval(keepalive);
					store.events.removeEventListener('change', onchange);
				};
				request.signal.addEventListener('abort', () => {
					cleanup();
					try { controller.close(); } catch { /* already closed */ }
				});
				send('retry: 3000\n\n');
			},
			cancel() {
				cleanup();
			}
		});
		return new Response(stream, {
			headers: { ...noStore, 'Content-Type': 'text/event-stream', 'X-Accel-Buffering': 'no' }
		});
	}
}

function fail400(message: string): never {
	throw new CommentError(400, message);
}
