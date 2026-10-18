// For the site's server: passes the browser's comment requests on to the
// comment server, with the space's secret and the person signed in on the site.
// Uses only the Fetch API, so it runs in Node, Bun, Deno and Workers.

import { USER_HEADER } from '../shared/protocol.js';

export interface CommentsProxyOptions {
	/** The comment server, e.g. `https://comments.convex.works`. */
	server: string;
	/** The site's space on it. */
	space: string;
	/** The space's secret. Keep it on the server. */
	secret: string;
	/** Where the browser reaches the comments on this site. Default `/_comments`. */
	path?: string;
}

/** The person signed in on the site, as its sign-in knows them. Null or undefined when nobody is. */
export type CommentsUser = { sub: string; name: string; email?: string; picture?: string } | null | undefined;

/** Matches SvelteKit's `Handle` without depending on SvelteKit. */
export type Handle<E extends { request: Request; locals: object }> = (input: {
	event: E;
	resolve: (event: E) => Response | Promise<Response>;
}) => Promise<Response>;

const REQUEST_HEADERS = ['content-type', 'accept', 'last-event-id'];
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'content-security-policy', 'x-content-type-options', 'x-accel-buffering'];

export function commentsProxy(options: CommentsProxyOptions) {
	const server = options.server.replace(/\/$/, '');
	const path = (options.path ?? '/_comments').replace(/\/$/, '');
	const space = encodeURIComponent(options.space);

	/** Answers requests under `path`; undefined for any other request. */
	async function handle(request: Request, user: CommentsUser): Promise<Response | undefined> {
		const url = new URL(request.url);
		if (url.pathname !== path && !url.pathname.startsWith(`${path}/`)) return undefined;
		const headers = new Headers({ Authorization: `Bearer ${options.secret}` });
		for (const name of REQUEST_HEADERS) {
			const value = request.headers.get(name);
			if (value) headers.set(name, value);
		}
		if (user) {
			const { sub, name, email, picture } = user;
			headers.set(USER_HEADER, base64url(JSON.stringify({ sub, name, email, picture })));
		}
		const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
		let response: Response;
		try {
			response = await fetch(`${server}/v1/spaces/${space}${url.pathname.slice(path.length)}${url.search}`, {
				method: request.method,
				headers,
				body: hasBody ? await request.arrayBuffer() : undefined,
				signal: request.signal,
				redirect: 'manual'
			});
		} catch {
			return Response.json({ error: 'The comments cannot be reached. Try again.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
		}
		const out = new Headers();
		for (const name of RESPONSE_HEADERS) {
			const value = response.headers.get(name);
			if (value) out.set(name, value);
		}
		return new Response(response.body, { status: response.status, headers: out });
	}

	/**
	 * SvelteKit's `handle` hook. Put it after the sign-in's hook; by default the
	 * user is `event.locals.user`.
	 */
	function sveltekit<E extends { request: Request; locals: object }>(
		user: (event: E) => CommentsUser | Promise<CommentsUser> = (event) => (event.locals as { user?: CommentsUser }).user
	): Handle<E> {
		return async ({ event, resolve }) => {
			const url = new URL(event.request.url);
			if (url.pathname !== path && !url.pathname.startsWith(`${path}/`)) return resolve(event);
			return (await handle(event.request, await user(event)))!;
		};
	}

	return { path, handle, sveltekit };
}

function base64url(text: string): string {
	let binary = '';
	for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
