import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { CommentsApi, type ApiOptions } from './api.ts';
import type { Spaces } from './spaces.ts';
import type { CommentStore } from './store.ts';

export interface AppConfig {
	store: CommentStore;
	spaces: Spaces;
	/** The built client, served at `/v1/`. */
	widgetDir?: string;
	/** Timings of long-polls and presence; the defaults suit production. */
	api?: ApiOptions;
}

const TYPES: Record<string, string> = {
	'.js': 'text/javascript; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png'
};

/** The whole server as one fetch-style handler. */
export function createApp(config: AppConfig) {
	const api = new CommentsApi(config.store, config.spaces, config.api);

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (url.pathname === '/healthz') return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
		if (config.widgetDir && /^\/v1\/visual-comments\.js(\.map)?$/.test(url.pathname)) {
			return (await file(config.widgetDir, url.pathname.slice('/v1/'.length), {
				// Any site may load the script; it talks to the site's own server.
				'Access-Control-Allow-Origin': '*',
				'Cross-Origin-Resource-Policy': 'cross-origin',
				'Cache-Control': 'public, max-age=300'
			})) ?? notFound();
		}
		return (await api.handle(request, url)) ?? notFound();
	};
}

const notFound = () => new Response('Not found', { status: 404 });

/** A file inside `dir`, or undefined. */
export async function file(dir: string, path: string, headers: Record<string, string> = {}): Promise<Response | undefined> {
	const target = normalize(join(dir, path));
	if (!target.startsWith(normalize(dir))) return undefined;
	try {
		const data = await readFile(target);
		return new Response(data, {
			headers: { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream', ...headers }
		});
	} catch {
		return undefined;
	}
}
