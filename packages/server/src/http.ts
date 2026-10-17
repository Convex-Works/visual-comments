import { createServer, type IncomingMessage, type Server } from 'node:http';
import { Readable } from 'node:stream';

export type Handler = (request: Request) => Promise<Response> | Response;

/** Request bodies stop here; images are the largest thing a client sends. */
const MAX_BODY_BYTES = 11 * 1024 * 1024;

/** Serves a fetch-style handler with Node's HTTP server. */
export function serve(handler: Handler, port: number, host?: string): Server {
	const server = createServer(async (req, res) => {
		const controller = new AbortController();
		res.on('close', () => controller.abort());
		let response: Response;
		try {
			response = await handler(toRequest(req, controller.signal));
		} catch (error) {
			if (!(error instanceof TooLarge)) console.error('[visual-comments] Request failed', error);
			response = error instanceof TooLarge
				? Response.json({ error: 'Request too large.' }, { status: 413 })
				: Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
		}
		res.statusCode = response.status;
		for (const [name, value] of response.headers) if (name !== 'set-cookie') res.setHeader(name, value);
		const cookies = response.headers.getSetCookie();
		if (cookies.length) res.setHeader('set-cookie', cookies);
		if (!response.body || req.method === 'HEAD') {
			res.end();
			return;
		}
		res.flushHeaders();
		const body = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
		body.on('error', () => res.destroy());
		body.pipe(res);
	});
	server.listen(port, host);
	return server;
}

class TooLarge extends Error {}

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
	const headers = new Headers();
	for (const [name, value] of Object.entries(req.headers)) {
		if (Array.isArray(value)) for (const item of value) headers.append(name, item);
		else if (value !== undefined) headers.set(name, value);
	}
	const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`;
	const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
	if (hasBody && Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) throw new TooLarge();
	let received = 0;
	const limit = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			received += chunk.byteLength;
			if (received > MAX_BODY_BYTES) controller.error(new TooLarge());
			else controller.enqueue(chunk);
		}
	});
	return new Request(url, {
		method: req.method,
		headers,
		body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>).pipeThrough(limit) : undefined,
		duplex: 'half',
		signal
	} as RequestInit);
}
