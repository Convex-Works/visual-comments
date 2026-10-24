import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Presence, type PresenceInput, type PresenceOptions } from './presence.ts';
import { agentSub, CommentError, type CommentStore } from './store.ts';
import { hasSecret, type Space, type Spaces } from './spaces.ts';
import { IMAGE_TYPES, MAX_BODY, MAX_CONTEXT, MAX_CONTEXT_VALUE, MAX_IMAGE_BYTES, MAX_IMAGES } from '../../client/src/lib/shared/limits.ts';
import { AGENT_HEADER, AGENT_TOKEN_PREFIX, USER_HEADER } from '../../client/src/lib/shared/protocol.ts';
import type {
	Agent, AgentInbox, AgentRequest, CommentAnchor, CommentsSnapshot, NewAgentRequest, Viewer
} from '../../client/src/lib/shared/types.ts';

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

const AGENTS_OFF = 'Agents are turned off for this space.';
const AGENT_GONE = 'This agent was removed, or its token has expired.';
const UNKNOWN_REQUEST = 'This request was denied or has expired.';
/** A space's requests to join waiting at once, so nobody can fill the memory with them. */
const MAX_REQUESTS = 20;
/** No I/O or 0/1, so the code reads the same on both screens. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';
const STATES = ['viewing', 'typing', 'working'];

export interface ApiOptions extends PresenceOptions {
	/** The longest `GET /agent/next` and the token pickup hold. Default 50 s, under common proxy timeouts. */
	maxWaitMs?: number;
	/** How long a request to join waits for a person. Default 10 minutes. */
	requestMs?: number;
	/** The inbox holds back a thread while its last author types in it, at most this long after their comment. Default 30 s. */
	typingHoldMs?: number;
}

/** An agent's request to join, until it collects its token. */
interface JoinRequest extends NewAgentRequest {
	space: string;
	/** Set when a person approved it. */
	answer?: { token: string; agent: Agent };
	/** Token pickups waiting for an answer. */
	waiting: Set<() => void>;
}

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

/** A short presence value. Too long is refused, not cut: hosts match pages and surfaces by it. */
function presenceText(value: unknown, max: number): string | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string' || value.length > max) fail400('Invalid presence.');
	return value;
}

function presenceInput(data: Record<string, unknown>): PresenceInput {
	const thread = data.thread ?? undefined;
	if (thread !== undefined && !(Number.isSafeInteger(thread) && (thread as number) > 0)) fail400('Invalid presence.');
	return {
		state: STATES.includes(data.state as string) ? data.state as PresenceInput['state'] : fail400('Invalid presence.'),
		page: presenceText(data.page, 2048),
		surface: presenceText(data.surface, 200),
		thread: thread as number | undefined,
		note: presenceText(data.note, 200)
	};
}

/** `?wait=` in seconds, as milliseconds, at most `max`. */
function waitOf(value: string | null, max: number): number {
	if (value === null) return max;
	const seconds = Number(value);
	if (!value.trim() || !(seconds >= 0)) fail400('Invalid wait.');
	return Math.min(seconds * 1000, max);
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Like `WXYZ-2345`. */
function joinCode(): string {
	const pick = (from: string, count: number) => Array.from({ length: count }, () => from[randomInt(from.length)]).join('');
	return `${pick(CODE_LETTERS, 4)}-${pick(CODE_DIGITS, 4)}`;
}

/** Waits up to `ms`; less when the request is aborted or `listen` calls the wake it is given. */
function until(ms: number, signal: AbortSignal, listen: (wake: () => void) => () => void): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	let unlisten = () => {};
	const wake = () => {
		clearTimeout(timer);
		signal.removeEventListener('abort', wake);
		unlisten();
		resolve();
	};
	const timer = setTimeout(wake, Math.max(0, ms));
	signal.addEventListener('abort', wake);
	unlisten = listen(wake);
	if (signal.aborted) wake();
	return promise;
}

/** Listens for `change` events of one space. */
function onChange(target: EventTarget, space: string, run: () => void): () => void {
	const listener = (event: Event) => {
		if ((event as CustomEvent<string>).detail === space) run();
	};
	target.addEventListener('change', listener);
	return () => target.removeEventListener('change', listener);
}

const requestOf = ({ id, name, code, expiresAt }: JoinRequest): AgentRequest => ({ id, name, code, expiresAt });

/**
 * The comment endpoints, under `/v1/spaces/<space>`. Only a site's server
 * calls them, with the space's secret and the person signed in on the site;
 * browsers reach them through that server.
 */
export class CommentsApi {
	private store: CommentStore;
	private spaces: Spaces;
	private presence: Presence;
	/** Requests to join, by id. In memory: they last minutes, and one instance serves every space. */
	private requests = new Map<string, JoinRequest>();
	private maxWaitMs: number;
	private requestMs: number;
	private typingHoldMs: number;

	constructor(store: CommentStore, spaces: Spaces, options: ApiOptions = {}) {
		this.store = store;
		this.spaces = spaces;
		this.presence = new Presence(options);
		this.maxWaitMs = options.maxWaitMs ?? 50_000;
		this.requestMs = options.requestMs ?? 10 * 60 * 1000;
		this.typingHoldMs = options.typingHoldMs ?? 30_000;
	}

	async handle(request: Request, url: URL): Promise<Response | undefined> {
		const match = url.pathname.match(/^\/v1\/spaces\/([a-z0-9-]+)(\/.*)?$/);
		if (!match) return undefined;
		const space = this.spaces.get(match[1]);
		// The same answer for an unknown space, so spaces cannot be found by trying.
		if (!space || !hasSecret(space, bearer(request))) return fail(401, 'Unknown space, or the wrong secret.');
		return this.route(request, url, space, (match[2] ?? '').replace(/\/$/, ''));
	}

	/** The person the site says is signed in, or the agent whose token the site passed on. */
	private identify(request: Request, space: Space): { viewer: Viewer; agent?: Agent } | null {
		const token = request.headers.get(AGENT_HEADER);
		if (!token) {
			const viewer = viewerOf(request);
			return viewer && { viewer };
		}
		if (request.headers.has(USER_HEADER)) throw new CommentError(400, 'Send a user or an agent, not both.');
		if (!space.agents) throw new CommentError(403, AGENTS_OFF);
		const agent = token.startsWith(AGENT_TOKEN_PREFIX) ? this.store.agentByToken(space.id, token) : undefined;
		if (!agent) throw new CommentError(401, AGENT_GONE);
		const viewer: Viewer = { sub: agentSub(agent.id), name: agent.name, agent: { addedBy: agent.addedBy } };
		this.presence.touch(space.id, viewer, agent.id);
		return { viewer, agent };
	}

	private async route(request: Request, url: URL, space: Space, route: string): Promise<Response> {
		const method = request.method;
		try {
			let match: RegExpMatchArray | null;
			if (/^\/agents?(\/|$)/.test(route) && !space.agents) return fail(403, AGENTS_OFF);
			// An agent asking to join has no identity yet, and a stale token must not stop it.
			if (route === '/agents/requests' && method === 'POST') return json(this.ask(space.id, await input(request)), 201);
			if ((match = route.match(/^\/agents\/requests\/([\w-]+)\/token$/)) && method === 'POST') {
				return await this.collect(request, space.id, match[1]);
			}

			const caller = this.identify(request, space);
			const viewer = caller?.viewer ?? null;
			const agent = caller?.agent;
			if (method === 'GET' && route === '') {
				const snapshot: CommentsSnapshot = {
					space: { id: space.id, name: space.name },
					viewer,
					threads: viewer ? this.store.list(space.id, viewer.sub) : []
				};
				return json(snapshot);
			}
			if (!viewer) return fail(401, 'Sign in to see comments.');
			if (method === 'GET' && route === '/events') return this.events(request, space.id, viewer, agent);
			if (route === '/presence' && method === 'POST') {
				this.setPresence(space.id, viewer, agent, await input(request));
				return new Response(null, { status: 204, headers: noStore });
			}
			if (route === '/agent/next' && method === 'GET') {
				if (!agent) return fail(403, 'Only agents have an inbox.');
				return await this.next(request, space.id, viewer, agent.id, waitOf(url.searchParams.get('wait'), this.maxWaitMs));
			}
			if (route === '/agents' && method === 'GET') return json({ agents: this.store.agents(space.id) });
			if ((match = route.match(/^\/agents\/([\w-]+)$/)) && method === 'DELETE' && match[1] !== 'requests') {
				const id = match[1];
				if (agent && agent.id !== id) return fail(403, 'Agents can only remove themselves.');
				this.store.removeAgent(space.id, id);
				this.presence.removeAgent(space.id, id);
				return json({ deleted: id });
			}
			if ((match = route.match(/^\/agents\/requests\/([\w-]+)(\/approve)?$/))) {
				if (agent) return fail(403, 'Only people can let agents in.');
				const pending = this.pending(space.id, match[1]);
				// Answered requests are gone for people, so nobody approves one twice.
				if (!pending || pending.answer) return fail(404, UNKNOWN_REQUEST);
				if (method === 'GET' && !match[2]) return json({ request: requestOf(pending) });
				if (method === 'POST' && match[2]) {
					pending.answer = this.store.addAgent(space.id, viewer, pending.name);
					for (const wake of pending.waiting) wake();
					return json({ agent: pending.answer.agent });
				}
				if (method === 'DELETE' && !match[2]) {
					this.requests.delete(pending.id);
					for (const wake of pending.waiting) wake();
					return json({ deleted: pending.id });
				}
			}
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

	// Agents joining.

	/** A request of the space that has not expired. */
	private pending(space: string, id: string): JoinRequest | undefined {
		const pending = this.requests.get(id);
		if (pending && pending.expiresAt <= Date.now()) {
			this.requests.delete(id);
			for (const wake of pending.waiting) wake();
			return undefined;
		}
		return pending?.space === space ? pending : undefined;
	}

	private ask(space: string, data: Record<string, unknown>): NewAgentRequest {
		const name = typeof data.name === 'string' ? data.name.trim() : '';
		if (!name || name.length > 60) fail400('Give the agent a name of up to 60 characters.');
		let count = 0;
		for (const pending of [...this.requests.values()]) if (this.pending(space, pending.id)) count++;
		if (count >= MAX_REQUESTS) throw new CommentError(429, 'Too many agents are waiting to join. Try again later.');
		const pending: JoinRequest = {
			id: randomBytes(24).toString('base64url'),
			name,
			code: joinCode(),
			expiresAt: Date.now() + this.requestMs,
			secret: randomBytes(24).toString('base64url'),
			space,
			waiting: new Set()
		};
		this.requests.set(pending.id, pending);
		return { ...requestOf(pending), secret: pending.secret };
	}

	/** The agent's token, once, as soon as a person approves; 202 while nobody has answered yet. */
	private async collect(request: Request, space: string, id: string): Promise<Response> {
		const data = await input(request);
		const secret = typeof data.secret === 'string' ? data.secret : '';
		const deadline = Date.now() + this.maxWaitMs;
		for (;;) {
			const pending = this.pending(space, id);
			// One answer for every failure, so ids cannot be probed without the secret.
			if (!pending || !timingSafeEqual(digest(pending.secret), digest(secret))) return fail(404, UNKNOWN_REQUEST);
			if (pending.answer) {
				this.requests.delete(id);
				return json(pending.answer);
			}
			const now = Date.now();
			if (now >= deadline || request.signal.aborted) return json({ pending: true }, 202);
			await until(Math.min(deadline, pending.expiresAt) - now, request.signal, (wake) => {
				pending.waiting.add(wake);
				return () => pending.waiting.delete(wake);
			});
		}
	}

	// Presence.

	private setPresence(space: string, viewer: Viewer, agent: Agent | undefined, data: Record<string, unknown>) {
		if (!agent) {
			if (typeof data.connection !== 'string' || data.key !== undefined) fail400('Invalid presence.');
			this.presence.update(space, viewer, { connection: data.connection }, presenceInput(data));
			return;
		}
		if (data.connection !== undefined) fail400('Invalid presence.');
		const key = presenceText(data.key, 200) ?? '';
		this.presence.update(space, viewer, { agent: agent.id, key }, data.state === 'gone' ? 'gone' : presenceInput(data));
	}

	/**
	 * The agent's inbox: holds until a thread has something new from someone
	 * else, then answers every such thread and marks them read for the agent.
	 */
	private async next(request: Request, space: string, viewer: Viewer, agent: string, wait: number): Promise<Response> {
		const deadline = Date.now() + wait;
		let removed = false;
		let wakeNow = () => {};
		const release = this.presence.hold(space, agent, () => {
			removed = true;
			wakeNow();
		});
		try {
			for (;;) {
				if (removed) return fail(401, AGENT_GONE);
				const now = Date.now();
				let wakeAt = deadline;
				const threads = this.store.unread(space, viewer.sub).filter((thread) => {
					// Someone still typing in the thread is likely to add to it: wait for the whole message.
					const last = thread.comments.at(-1)!;
					const holdUntil = last.createdAt + this.typingHoldMs;
					if (now >= holdUntil || !this.presence.typing(space, last.author.sub, thread.id)) return true;
					wakeAt = Math.min(wakeAt, holdUntil);
					return false;
				});
				if (threads.length || now >= deadline || request.signal.aborted) {
					if (threads.length) this.store.markSeen(space, viewer.sub, threads);
					const inbox: AgentInbox = { threads, participants: this.presence.participants(space) };
					return json(inbox);
				}
				await until(wakeAt - now, request.signal, (wake) => {
					wakeNow = wake;
					const offStore = onChange(this.store.events, space, wake);
					const offPresence = onChange(this.presence.events, space, wake);
					return () => {
						wakeNow = () => {};
						offStore();
						offPresence();
					};
				});
			}
		} finally {
			release();
		}
	}

	/**
	 * Server-sent events: `hello` with the stream's connection, `presence` with
	 * everyone here whenever that changes, and `change` after any write in the
	 * space, so clients refetch. A person is present while their stream is open.
	 */
	private events(request: Request, space: string, viewer: Viewer, agent: Agent | undefined): Response {
		const encoder = new TextEncoder();
		const { store, presence } = this;
		let cleanup = () => {};
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const send = (chunk: string) => {
					try { controller.enqueue(encoder.encode(chunk)); } catch { cleanup(); }
				};
				const sendPresence = () => send(`event: presence\ndata: ${JSON.stringify({ participants: presence.participants(space) })}\n\n`);
				const close = () => {
					cleanup();
					try { controller.close(); } catch { /* already closed */ }
				};
				const connection = agent ? randomBytes(16).toString('base64url') : presence.connect(space, viewer);
				// An agent's stream keeps it present, and ends when it is removed.
				const leave = agent ? presence.hold(space, agent.id, close) : () => presence.disconnect(space, connection);
				const keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS);
				const offStore = onChange(store.events, space, () => send('event: change\ndata: {}\n\n'));
				const offPresence = onChange(presence.events, space, sendPresence);
				let open = true;
				cleanup = () => {
					if (!open) return;
					open = false;
					clearInterval(keepalive);
					offStore();
					offPresence();
					leave();
				};
				request.signal.addEventListener('abort', close);
				send('retry: 3000\n\n');
				send(`event: hello\ndata: ${JSON.stringify({ connection })}\n\n`);
				sendPresence();
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
