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
const { commentsProxy } = await import('../../client/src/lib/server/index.ts');

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
