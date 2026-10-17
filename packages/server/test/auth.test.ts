import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, test } from 'node:test';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createApp } from '../src/app.ts';
import { Spaces } from '../src/spaces.ts';
import { CommentStore } from '../src/store.ts';

const issuer = 'https://identity.example';
const server = 'https://comments.example';
const site = 'https://app.example';
const clientId = 'visual-comments-test';
const clientSecret = 'test-only-client-secret';
const pair = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' };
const originalFetch = globalThis.fetch;
const spaces = Spaces.parse({
	app: { name: 'App', origins: [site], members: ['*@example.com', 'group:reviewers'] }
});
let authorization: URL;
let claims: Record<string, unknown> = {};
const stores: CommentStore[] = [];

before(() => {
	globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : input);
		assert.equal(url.origin, issuer);
		if (url.pathname === '/.well-known/openid-configuration') return Response.json({
			issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks`,
			id_token_signing_alg_values_supported: ['RS256'], authorization_response_iss_parameter_supported: true,
			token_endpoint_auth_methods_supported: ['client_secret_post']
		});
		if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
		if (url.pathname === '/token') {
			const body = new URLSearchParams(init!.body as string);
			assert.equal(body.get('client_secret'), clientSecret);
			assert.equal(body.get('redirect_uri'), `${server}/auth/callback`);
			assert.equal(body.get('code'), 'valid-code');
			assert.equal(createHash('sha256').update(body.get('code_verifier')!).digest('base64url'), authorization.searchParams.get('code_challenge'));
			const now = Math.floor(Date.now() / 1000);
			const idToken = await new SignJWT({
				iss: issuer, aud: clientId, sub: 'user-1', iat: now, exp: now + 3600, nonce: authorization.searchParams.get('nonce'),
				name: 'Florence Example', email: 'Florence@Example.com', picture: 'https://images.example/f.png', ...claims
			}).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(pair.privateKey);
			return Response.json({ id_token: idToken, access_token: 'private-access-token', token_type: 'Bearer', expires_in: 3600 });
		}
		throw Error(`Unexpected request ${url.pathname}`);
	};
});
after(() => {
	globalThis.fetch = originalFetch;
	for (const store of stores) store.close();
});

function setup() {
	claims = {};
	const store = new CommentStore(':memory:');
	stores.push(store);
	const app = createApp({ store, spaces, publicUrl: server, oidc: { issuer, clientId, clientSecret } });
	const get = (path: string, headers: Record<string, string> = {}) => app(new Request(new URL(path, server), { headers }));
	return { app, store, get };
}

const login = (mode = 'popup', back = `${site}/settings?tab=2#billing`) =>
	`/auth/login?${new URLSearchParams({ space: 'app', return: back, mode })}`;

/** Starts a sign-in and comes back from the provider as it would. */
async function signIn(context: ReturnType<typeof setup>, mode = 'popup', cookie?: (value: string) => string) {
	const started = await context.get(login(mode));
	assert.equal(started.status, 303);
	authorization = new URL(started.headers.get('location')!);
	assert.equal(authorization.origin, issuer);
	assert.equal(authorization.searchParams.get('redirect_uri'), `${server}/auth/callback`);
	assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
	const set = started.headers.getSetCookie()[0];
	assert.match(set, /^vc_login=[\w-]+; Path=\/auth; HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
	const value = set.split(';')[0];
	const callback = `/auth/callback?code=valid-code&state=${authorization.searchParams.get('state')}&iss=${encodeURIComponent(issuer)}`;
	return context.get(callback, { cookie: cookie ? cookie(value) : value });
}

const tokenIn = (html: string) => /"token":"([\w-]+)"/.exec(html)?.[1];

test('a popup sign-in posts a token for the space to its opener, at the site’s origin only', async () => {
	const context = setup();
	const response = await signIn(context);
	assert.equal(response.status, 200);
	const html = await response.text();
	assert.match(html, /window\.opener\.postMessage\(message, "https:\/\/app\.example"\)/);
	// Without an opener it returns to the site with the token in the fragment instead.
	assert.match(html, /location\.replace\("https:\/\/app\.example\/settings\?tab=2#vc-space=app&vc-token=[\w-]+&vc-popup=1"\)/);
	assert.match(response.headers.get('content-security-policy')!, /script-src 'nonce-/);
	assert.match(response.headers.getSetCookie()[0], /^vc_login=; .*Max-Age=0/);

	const token = tokenIn(html)!;
	const snapshot = await context.app(new Request(`${server}/v1/spaces/app`, { headers: { origin: site, authorization: `Bearer ${token}` } }));
	assert.deepEqual((await snapshot.json()).viewer, {
		sub: 'user-1', name: 'Florence Example', email: 'florence@example.com', picture: 'https://images.example/f.png'
	});
});

test('a redirect sign-in returns to the page with the token in the fragment', async () => {
	const response = await signIn(setup(), 'redirect');
	assert.equal(response.status, 303);
	assert.match(response.headers.get('location')!, /^https:\/\/app\.example\/settings\?tab=2#vc-space=app&vc-token=[\w-]+$/);
});

test('a sign-in finishes only in the browser that started it, once', async () => {
	const context = setup();
	const stolen = await signIn(context, 'popup', () => 'vc_login=someone-else');
	assert.equal(stolen.status, 400);
	assert.match(await stolen.text(), /Sign-in expired/);

	const done = await signIn(context);
	assert.equal(done.status, 200);
	const again = await context.get(`/auth/callback?code=valid-code&state=${authorization.searchParams.get('state')}`);
	assert.equal(again.status, 400);
});

test('only members of the space get a token', async () => {
	const context = setup();
	const outsider = async (extra: Record<string, unknown>) => {
		const response = await (async () => {
			const started = await context.get(login());
			authorization = new URL(started.headers.get('location')!);
			claims = extra;
			return context.get(`/auth/callback?code=valid-code&state=${authorization.searchParams.get('state')}&iss=${encodeURIComponent(issuer)}`,
				{ cookie: started.headers.getSetCookie()[0].split(';')[0] });
		})();
		return response.text();
	};
	const stranger = await outsider({ email: 'eve@elsewhere.example' });
	assert.match(stranger, /is not a member of “App”/);
	assert.equal(tokenIn(stranger), undefined);
	// An address the provider has not verified does not count.
	assert.equal(tokenIn(await outsider({ email_verified: false })), undefined);
	// A group the space admits does.
	assert.ok(tokenIn(await outsider({ email: 'eve@elsewhere.example', groups: ['reviewers'] })));
});

test('sign-in only returns to the space’s sites', async () => {
	const context = setup();
	const elsewhere = await context.get(login('popup', 'https://evil.example/'));
	assert.equal(elsewhere.status, 403);
	assert.equal(elsewhere.headers.getSetCookie().length, 0);
	assert.equal((await context.get('/auth/login?space=nowhere&return=https%3A%2F%2Fapp.example%2F')).status, 404);
	assert.equal((await context.get('/auth/login?space=app')).status, 400);
});

test('development sign-in runs only on localhost and asks for a name', async () => {
	const store = new CommentStore(':memory:');
	stores.push(store);
	assert.throws(() => createApp({ store, spaces, publicUrl: server, devLogin: true }), /only runs on localhost/);
	const local = 'http://localhost:4400';
	const app = createApp({ store, spaces: Spaces.parse({ app: { name: 'App', origins: [site], members: ['*'] } }), publicUrl: local, devLogin: true });
	const form = await app(new Request(`${local}${login()}`));
	assert.match(await form.text(), /Development sign-in/);
	const body = new URLSearchParams({ space: 'app', return: `${site}/`, mode: 'popup', name: 'Dev Person', email: 'dev@example.com' });
	const foreign = await app(new Request(`${local}/auth/dev`, { method: 'POST', body, headers: { origin: 'https://evil.example' } }));
	assert.equal(foreign.status, 403);
	const done = await app(new Request(`${local}/auth/dev`, { method: 'POST', body, headers: { origin: local } }));
	assert.ok(tokenIn(await done.text()));
});
