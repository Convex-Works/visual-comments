import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { registerHooks } from 'node:module';
import { after, test } from 'node:test';
import { serve } from '../src/http.ts';
import { AGENT_HEADER, USER_HEADER } from '../../client/src/lib/shared/protocol.ts';

// The client's sources import `.js` for svelte-package; here only the `.ts` files exist. The proxy
// is imported dynamically so that this hook is in place first.
registerHooks({
	resolve(specifier, context, next) {
		try {
			return next(specifier, context);
		} catch (error) {
			if (!specifier.startsWith('.') || !specifier.endsWith('.js')) throw error;
			return next(`${specifier.slice(0, -3)}.ts`, context);
		}
	}
});
const { commentsFromEnv, commentsProxy, commentsVariables } = await import('../../client/src/lib/server/index.ts');

const secret = 'app-secret-for-tests-only-0123456789';
// A comment server that answers with the headers it got.
const upstream = serve((request) => Response.json({
	path: new URL(request.url).pathname,
	authorization: request.headers.get('authorization'),
	user: request.headers.get(USER_HEADER),
	agent: request.headers.get(AGENT_HEADER)
}), 0, '127.0.0.1');
after(() => upstream.close());

async function proxied(headers: Record<string, string>, user = { sub: 'user-ada', name: 'Ada Example' }) {
	await new Promise((resolve) => upstream.listening ? resolve(null) : upstream.once('listening', resolve));
	const { port } = upstream.address() as AddressInfo;
	const proxy = commentsProxy({ server: `http://127.0.0.1:${port}`, space: 'app', secret });
	const response = await proxy.handle(new Request('https://app.example/_comments/agent/next', { headers }), user);
	return response!.json();
}

test('the proxy passes an agent’s token on instead of the person signed in', async () => {
	const agent = await proxied({ authorization: 'Bearer vca_token-of-the-agent' });
	assert.deepEqual(agent, {
		path: '/v1/spaces/app/agent/next', authorization: `Bearer ${secret}`, user: null, agent: 'vca_token-of-the-agent'
	});
});

test('the proxy ignores any other bearer token', async () => {
	const person = await proxied({ authorization: 'Bearer something-else' });
	assert.equal(person.authorization, `Bearer ${secret}`);
	assert.equal(person.agent, null);
	assert.deepEqual(JSON.parse(Buffer.from(person.user, 'base64url').toString()), { sub: 'user-ada', name: 'Ada Example' });
});

const settings = { VISUAL_COMMENTS_SERVER: 'https://comments.example', VISUAL_COMMENTS_SPACE: 'app', VISUAL_COMMENTS_SECRET: secret };

test('comments are off unless an environment variable turns them on', async () => {
	for (const env of [{}, settings, { ...settings, VISUAL_COMMENTS_ENABLED: 'false' }, { ...settings, VISUAL_COMMENTS_ENABLED: '' }]) {
		const comments = commentsFromEnv(env);
		assert.equal(comments.enabled, false);
		assert.equal(comments.client, null);
		assert.equal(await comments.handle(new Request('https://app.example/_comments/'), null), undefined);
		// The hook passes comment requests on to the app, which has no such route.
		const passed = await comments.sveltekit()({
			event: { request: new Request('https://app.example/_comments/'), locals: {} },
			resolve: () => new Response('the app')
		});
		assert.equal(await passed.text(), 'the app');
	}
});

test('dev turns comments on only while the dev server runs', () => {
	const env = { ...settings, VISUAL_COMMENTS_ENABLED: 'dev' };
	assert.equal(commentsFromEnv(env, { dev: true }).enabled, true);
	assert.equal(commentsFromEnv(env, { dev: false }).enabled, false);
	assert.throws(() => commentsFromEnv(env), /needs \{ dev \}/);
});

test('on, the comments answer at the configured path and tell the browser where they are', async () => {
	await new Promise((resolve) => upstream.listening ? resolve(null) : upstream.once('listening', resolve));
	const { port } = upstream.address() as AddressInfo;
	const comments = commentsFromEnv({
		...settings, VISUAL_COMMENTS_ENABLED: 'true', VISUAL_COMMENTS_SERVER: `http://127.0.0.1:${port}`,
		VISUAL_COMMENTS_PATH: '/app/_comments/', VISUAL_COMMENTS_AUTH: '/app/auth'
	});
	assert.deepEqual(comments.client, { endpoint: '/app/_comments', auth: '/app/auth' });
	assert.equal(await comments.handle(new Request('https://app.example/_comments/threads'), null), undefined);
	const response = await comments.handle(new Request('https://app.example/app/_comments/threads'), null);
	assert.equal((await response!.json()).path, '/v1/spaces/app/threads');
});

test('on, a missing or invalid setting stops the app at start', () => {
	const on = { ...settings, VISUAL_COMMENTS_ENABLED: 'true' };
	assert.throws(() => commentsFromEnv({ ...on, VISUAL_COMMENTS_SECRET: undefined }), /VISUAL_COMMENTS_SECRET must be set/);
	assert.throws(() => commentsFromEnv({ ...on, VISUAL_COMMENTS_SECRET: 'short' }), /at least 32 characters/);
	assert.throws(() => commentsFromEnv({ ...on, VISUAL_COMMENTS_SERVER: 'comments.example' }), /http\(s\) URL/);
	assert.throws(() => commentsFromEnv({ ...on, VISUAL_COMMENTS_PATH: '_comments' }), /starts with \//);
	assert.throws(() => commentsFromEnv({ ...settings, VISUAL_COMMENTS_ENABLED: 'yes' }), /true, false or dev/);
});

test('the SvelteKit variables check each value and leave unset ones unset', () => {
	assert.equal(commentsVariables.VISUAL_COMMENTS_ENABLED.schema(undefined), undefined);
	assert.equal(commentsVariables.VISUAL_COMMENTS_ENABLED.schema('dev'), 'dev');
	assert.throws(() => commentsVariables.VISUAL_COMMENTS_ENABLED.schema('on'), /true, false or dev/);
	assert.throws(() => commentsVariables.VISUAL_COMMENTS_SECRET.schema('short'), /at least 32 characters/);
});

/** The person a proxied request names, as the comment server reads them. */
function person(header: string | null) {
	return header && JSON.parse(Buffer.from(header, 'base64url').toString());
}

test('with their own sign-in, the comments sign people in apart from the site', async () => {
	await new Promise((resolve) => upstream.listening ? resolve(null) : upstream.once('listening', resolve));
	const { port } = upstream.address() as AddressInfo;
	const comments = commentsFromEnv(
		{ ...settings, VISUAL_COMMENTS_ENABLED: 'dev', VISUAL_COMMENTS_SERVER: `http://127.0.0.1:${port}` },
		{ dev: true, signIn: { devHosts: ['100.64.0.2'] } }
	);
	const hook = comments.sveltekit();
	const site = 'http://100.64.0.2:5173';
	const call = (path: string, init: RequestInit = {}) => hook({
		// The site's own sign-in has someone else; the comments do not look.
		event: { request: new Request(`${site}${path}`, init), locals: { user: { sub: 'site-user', name: 'Someone Else' } } },
		resolve: () => new Response('the app')
	});

	// The development sign-in, on a devHosts address.
	assert.equal((await call('/auth/login')).status, 200);
	const signedIn = await call('/auth/dev', { method: 'POST', headers: { origin: site }, body: new URLSearchParams({ name: 'Ada' }) });
	const cookie = signedIn.headers.get('set-cookie')!.split(';')[0];
	assert.match(cookie, /^visual_comments_session=/);

	const anonymous = await (await call('/_comments/threads')).json();
	assert.equal(anonymous.user, null);
	const signed = await (await call('/_comments/threads', { headers: { cookie } })).json();
	assert.deepEqual(person(signed.user), { sub: 'dev:ada', name: 'Ada' });
	assert.equal(signed.path, '/v1/spaces/app/threads');
	assert.equal(await (await call('/projects', { headers: { cookie } })).text(), 'the app');

	// The layout's load says who is signed in, so the page shows it at once.
	const page = (init: RequestInit = {}) => comments.load({ request: new Request(`${site}/projects`, init) });
	assert.deepEqual(await page(), { endpoint: '/_comments', auth: '/auth', viewer: null });
	assert.deepEqual((await page({ headers: { cookie } }))?.viewer, { sub: 'dev:ada', name: 'Ada' });

	// The development sessions outlast a restart: their key comes from the space's secret.
	const restarted = commentsFromEnv(
		{ ...settings, VISUAL_COMMENTS_ENABLED: 'dev', VISUAL_COMMENTS_SERVER: `http://127.0.0.1:${port}` },
		{ dev: true, signIn: true }
	);
	assert.equal((await restarted.load({ request: new Request(`${site}/projects`, { headers: { cookie } }) }))?.viewer?.name, 'Ada');
});

test('their own sign-in needs a provider outside the dev server, and all of it', () => {
	const on = { ...settings, VISUAL_COMMENTS_ENABLED: 'true' };
	assert.throws(() => commentsFromEnv(on, { signIn: true }), /VISUAL_COMMENTS_OIDC_ISSUER must be set/);
	assert.throws(() => commentsFromEnv({ ...on, VISUAL_COMMENTS_ENABLED: 'dev', VISUAL_COMMENTS_OIDC_CLIENT_ID: 'comments' }, { dev: true, signIn: true }),
		/VISUAL_COMMENTS_OIDC_ISSUER must be set/);
	const provider = {
		VISUAL_COMMENTS_OIDC_ISSUER: 'https://id.example', VISUAL_COMMENTS_OIDC_CLIENT_ID: 'comments',
		VISUAL_COMMENTS_OIDC_CLIENT_SECRET: 'client-secret', VISUAL_COMMENTS_SESSION_SECRET: 'session-secret-for-tests-only-0123456789'
	};
	assert.equal(commentsFromEnv({ ...on, ...provider }, { signIn: true }).enabled, true);
	assert.throws(() => commentsFromEnv({ ...on, ...provider, VISUAL_COMMENTS_SESSION_SECRET: 'short' }, { signIn: true }), /at least 32 characters/);
});

test('the Vite plugin leaves the comments out of builds that do not ask for them', async () => {
	const { visualComments } = await import('../../client/src/lib/vite/index.ts');
	const lib = decodeURIComponent(new URL('../../client/src/lib/', import.meta.url).pathname);
	type Hook = (...args: unknown[]) => unknown;
	const run = (include: boolean | undefined, command: 'serve' | 'build') => {
		const plugin = visualComments(include === undefined ? {} : { include });
		const config = (plugin.config as Hook)({}, { command, mode: 'production' });
		const load = (id: string) => (plugin.load as Hook)(id);
		return { config, env: load(`${lib}server/env.js`), comments: load(`${lib}sveltekit/Comments.svelte`), other: load(`${lib}server/index.js`) };
	};

	const left = run(undefined, 'build');
	assert.deepEqual(left.config, { ssr: { noExternal: ['visual-comments'] } });
	assert.match(String(left.env), /export function commentsFromEnv/);
	assert.match(String(left.comments), /\{@render children\?\.\(\)\}/);
	assert.doesNotMatch(String((visualComments().load as Hook)(`${lib}sveltekit/CommentTools.svelte`)), /data-vc-toggle/);
	assert.equal(left.other, undefined);

	for (const kept of [run(undefined, 'serve'), run(true, 'build')]) {
		assert.equal(kept.config, undefined);
		assert.equal(kept.env, undefined);
	}
	const before = process.env.VISUAL_COMMENTS_BUILD;
	process.env.VISUAL_COMMENTS_BUILD = 'true';
	try {
		assert.equal(run(undefined, 'build').env, undefined);
	} finally {
		if (before === undefined) delete process.env.VISUAL_COMMENTS_BUILD;
		else process.env.VISUAL_COMMENTS_BUILD = before;
	}
});
