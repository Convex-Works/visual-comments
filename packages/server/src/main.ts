import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createApp, file } from './app.ts';
import { serve } from './http.ts';
import { Spaces } from './spaces.ts';
import { CommentStore } from './store.ts';

const env = process.env;
const port = Number(env.PORT ?? 4400);
const publicUrl = env.PUBLIC_URL ?? `http://localhost:${port}`;
const widgetDir = env.WIDGET_DIR ?? fileURLToPath(new URL('../../client/dist-widget/', import.meta.url));

const store = new CommentStore(env.DATABASE ?? 'data/comments.sqlite');
const spaces = Spaces.load(env.SPACES ?? 'spaces.json');
const app = createApp({
	store,
	spaces,
	publicUrl,
	widgetDir,
	oidc: env.OIDC_CLIENT_SECRET
		? { issuer: env.OIDC_ISSUER ?? 'https://id.convex.works', clientId: env.OIDC_CLIENT_ID ?? '', clientSecret: env.OIDC_CLIENT_SECRET }
		: undefined,
	devLogin: env.DEV_LOGIN === '1'
});

const server = serve(app, port);
console.log(`visual-comments on ${publicUrl}`);

// A second site on another port shows the examples, so they talk to the server across origins as real sites do.
const examplesPort = env.EXAMPLES_PORT ? Number(env.EXAMPLES_PORT) : undefined;
const examplesDir = fileURLToPath(new URL('../../../examples/', import.meta.url));
const examples = examplesPort && serve(async (request) => {
	const path = new URL(request.url).pathname;
	const response = await file(examplesDir, path.endsWith('/') ? `${path}index.html` : path, { 'Cache-Control': 'no-store' });
	if (!response) return new Response('Not found', { status: 404 });
	if (!path.endsWith('/') && !path.endsWith('.html')) return response;
	const html = (await readFile(`${examplesDir}${path.endsWith('/') ? `${path}index.html` : path}`, 'utf8')).replaceAll('{{SERVER}}', publicUrl);
	return new Response(html, { headers: response.headers });
}, examplesPort);
if (examplesPort) console.log(`examples on http://localhost:${examplesPort}/`);

// Closing the database checkpoints the WAL into the database file.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		server.close();
		if (examples) examples.close();
		store.close();
		process.exit(0);
	});
}
process.once('exit', () => store.close());
