// The examples as a site with its own server, as real sites have: it signs
// people in, and passes comment requests on to the comment server with the
// space's secret. Without OIDC settings, it signs in with any name.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createSignIn } from '@cnvx/sign-in/server';
import { commentsProxy } from 'visual-comments/server';
import { file } from '../packages/server/src/app.ts';
import { serve } from '../packages/server/src/http.ts';

const env = process.env;
const port = Number(env.PORT ?? 4401);
const server = env.COMMENTS_SERVER ?? 'http://localhost:4400';
const dir = fileURLToPath(new URL('./', import.meta.url));

const signIn = createSignIn({
	issuer: env.OIDC_ISSUER ?? 'https://id.convex.works',
	clientId: env.OIDC_CLIENT_ID,
	clientSecret: env.OIDC_CLIENT_SECRET,
	secret: env.SESSION_SECRET,
	scope: 'openid profile email groups offline_access',
	devLogin: true
});
const comments = commentsProxy({ server, space: 'demo', secret: 'development-only-secret-for-the-demo-space' });

serve(signIn.wrap(async (request, user) => (await comments.handle(request, user)) ?? page(request)), port);
console.log(`examples on http://localhost:${port}/ (sign-in: ${signIn.mode})`);

async function page(request: Request): Promise<Response> {
	const path = new URL(request.url).pathname;
	const name = path.endsWith('/') ? `${path}index.html` : path;
	if (!name.endsWith('.html')) return (await file(dir, name, { 'Cache-Control': 'no-store' })) ?? notFound();
	try {
		const html = (await readFile(`${dir}${name}`, 'utf8')).replaceAll('{{SERVER}}', server);
		return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
	} catch {
		return notFound();
	}
}

function notFound() {
	return new Response('Not found', { status: 404 });
}
