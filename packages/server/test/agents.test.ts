import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApp } from '../src/app.ts';
import { Spaces } from '../src/spaces.ts';
import { CommentStore } from '../src/store.ts';
import { AGENT_HEADER, USER_HEADER } from '../../client/src/lib/shared/protocol.ts';
import type { Participant } from '../../client/src/lib/shared/types.ts';

const site = 'https://app.example';
const server = 'https://comments.example';
const secrets = { app: 'app-secret-for-tests-only-0123456789', off: 'off-secret-for-tests-only-0123456789' };
const people = {
	ada: { sub: 'user-ada', name: 'Ada Example', email: 'ada@example.com', picture: 'https://images.example/ada.png' },
	ben: { sub: 'user-ben', name: 'Ben Example', email: 'ben@example.com' }
};
type Person = keyof typeof people;
const spaces = Spaces.parse({
	app: { name: 'App', secret: secrets.app },
	off: { name: 'No agents', secret: secrets.off, agents: false }
});
const stores: CommentStore[] = [];
after(() => { for (const store of stores) store.close(); });

// Short timings, so long-polls and presence settle within a test.
const timings = { maxWaitMs: 400, requestMs: 60_000, typingHoldMs: 1000, typingMs: 150, agentMs: 250, coalesceMs: 5 };

interface CallOptions {
	as?: Person;
	/** An agent's token. */
	agent?: string;
	method?: string;
	body?: unknown;
	headers?: Record<string, string>;
	space?: keyof typeof secrets;
	signal?: AbortSignal;
}

function setup(options: Partial<typeof timings> = {}) {
	const store = new CommentStore(':memory:');
	stores.push(store);
	const app = createApp({ store, spaces, api: { ...timings, ...options } });
	/** What a site's server sends: the space's secret, and who is signed in or the agent's token. */
	const headers = ({ as, agent, space = 'app' }: CallOptions = {}) => ({
		authorization: `Bearer ${secrets[space]}`,
		...(as ? { [USER_HEADER]: Buffer.from(JSON.stringify(people[as])).toString('base64url') } : {}),
		...(agent ? { [AGENT_HEADER]: agent } : {})
	});
	const request = (path: string, options: CallOptions = {}) => app(new Request(new URL(path, server), {
		method: options.method ?? 'GET',
		headers: {
			...headers(options),
			...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
			...options.headers
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		signal: options.signal
	}));
	const call = async (path: string, options: CallOptions = {}) => {
		const response = await request(path, options);
		return { status: response.status, body: await response.json().catch(() => null) };
	};
	const place = { page: `${site}/overview`, url: `${site}/overview`, surface: '', title: 'Overview' };
	const start = (as: Person = 'ada', body = 'Tighten this heading') =>
		call('/v1/spaces/app/threads', { as, method: 'POST', body: { ...place, x: 10, y: 20, body } });
	/** An agent that asked, was approved by `by`, and collected its token. */
	const join = async (name = 'Claude', by: Person = 'ada') => {
		const asked = await call('/v1/spaces/app/agents/requests', { method: 'POST', body: { name } });
		await call(`/v1/spaces/app/agents/requests/${asked.body.id}/approve`, { as: by, method: 'POST' });
		const collected = await call(`/v1/spaces/app/agents/requests/${asked.body.id}/token`, {
			method: 'POST', body: { secret: asked.body.secret }
		});
		return collected.body as { token: string; agent: { id: string; name: string } };
	};
	/** An open event stream, read event by event. */
	const stream = async (options: CallOptions) => {
		const controller = new AbortController();
		const response = await request('/v1/spaces/app/events', { ...options, signal: controller.signal });
		assert.equal(response.status, 200);
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		/** The next event of a type, skipping the others. */
		const next = async (type: string) => {
			for (;;) {
				const end = buffer.indexOf('\n\n');
				if (end >= 0) {
					const block = buffer.slice(0, end);
					buffer = buffer.slice(end + 2);
					if (/^event: (.+)$/m.exec(block)?.[1] === type) return JSON.parse(/^data: (.*)$/m.exec(block)![1]);
					continue;
				}
				const { value, done } = await reader.read();
				if (done) throw new Error('The stream ended.');
				buffer += decoder.decode(value);
			}
		};
		/** The next participants that match. */
		const presence = async (matches: (participants: Participant[]) => boolean) => {
			for (;;) {
				const { participants } = await next('presence') as { participants: Participant[] };
				if (matches(participants)) return participants;
			}
		};
		const ended = async () => {
			for (;;) if ((await reader.read()).done) return true;
		};
		const { connection } = await next('hello') as { connection: string };
		return { connection, next, presence, ended, close: () => controller.abort() };
	};
	return { store, call, start, join, stream };
}

test('an agent asks to join, a person approves, and the agent collects its token once', async () => {
	const { call } = setup();
	const asked = await call('/v1/spaces/app/agents/requests', { method: 'POST', body: { name: '  Claude  ' } });
	assert.equal(asked.status, 201);
	assert.equal(asked.body.name, 'Claude');
	assert.match(asked.body.code, /^[A-HJ-NP-Z]{4}-[2-9]{4}$/);
	assert.ok(asked.body.id.length >= 32 && asked.body.secret.length >= 32);
	const path = `/v1/spaces/app/agents/requests/${asked.body.id}`;

	// Nobody has answered: the pickup holds, then says so.
	const pending = await call(`${path}/token`, { method: 'POST', body: { secret: asked.body.secret } });
	assert.deepEqual([pending.status, pending.body], [202, { pending: true }]);

	assert.equal((await call(path)).status, 401);
	const shown = await call(path, { as: 'ben' });
	assert.deepEqual(shown.body.request, { id: asked.body.id, name: 'Claude', code: asked.body.code, expiresAt: asked.body.expiresAt });

	// A pickup already waiting gets the token as soon as a person approves.
	const waiting = call(`${path}/token`, { method: 'POST', body: { secret: asked.body.secret } });
	await sleep(20);
	const approved = await call(`${path}/approve`, { as: 'ben', method: 'POST' });
	assert.equal(approved.status, 200);
	assert.deepEqual(approved.body.agent.addedBy, { sub: 'user-ben', name: 'Ben Example' });
	assert.equal(approved.body.agent.name, 'Claude');
	const collected = await waiting;
	assert.equal(collected.status, 200);
	assert.match(collected.body.token, /^vca_/);
	assert.deepEqual(collected.body.agent, approved.body.agent);

	assert.equal((await call(`${path}/token`, { method: 'POST', body: { secret: asked.body.secret } })).status, 404);
	assert.equal((await call(`${path}/approve`, { as: 'ben', method: 'POST' })).status, 404);
	const listed = await call('/v1/spaces/app/agents', { as: 'ada' });
	assert.deepEqual(listed.body.agents.map((agent: { id: string }) => agent.id), [approved.body.agent.id]);
});

test('a denied request, a wrong secret and a bad name get nothing', async () => {
	const { call } = setup();
	assert.equal((await call('/v1/spaces/app/agents/requests', { method: 'POST', body: { name: ' ' } })).status, 400);
	assert.equal((await call('/v1/spaces/app/agents/requests', { method: 'POST', body: { name: 'x'.repeat(61) } })).status, 400);

	const asked = await call('/v1/spaces/app/agents/requests', { method: 'POST', body: { name: 'Claude' } });
	const path = `/v1/spaces/app/agents/requests/${asked.body.id}`;
	const wrong = await call(`${path}/token`, { method: 'POST', body: { secret: 'guess' } });
	assert.equal(wrong.status, 404);

	const waiting = call(`${path}/token`, { method: 'POST', body: { secret: asked.body.secret } });
	await sleep(20);
	assert.deepEqual((await call(path, { as: 'ada', method: 'DELETE' })).body, { deleted: asked.body.id });
	const denied = await waiting;
	assert.equal(denied.status, 404);
	assert.equal(denied.body.error, wrong.body.error);
	assert.equal((await call(path, { as: 'ada' })).status, 404);
	assert.equal((await call('/v1/spaces/app/agents/requests/unknown/token', { method: 'POST', body: { secret: 'x' } })).status, 404);
});

test('requests expire, and a space only keeps a few waiting', async () => {
	const { call } = setup({ requestMs: 100 });
	const asked = await call('/v1/spaces/app/agents/requests', { method: 'POST', body: { name: 'Claude' } });
	const expired = await call(`/v1/spaces/app/agents/requests/${asked.body.id}/token`, {
		method: 'POST', body: { secret: asked.body.secret }
	});
	assert.equal(expired.status, 404);

	for (let i = 0; i < 20; i++) {
		assert.equal((await call('/v1/spaces/app/agents/requests', { method: 'POST', body: { name: `Agent ${i}` } })).status, 201);
	}
	assert.equal((await call('/v1/spaces/app/agents/requests', { method: 'POST', body: { name: 'One more' } })).status, 429);
});

test('a space can turn agents off', async () => {
	const { call, join } = setup();
	const { token } = await join();
	const off = { space: 'off' as const };
	assert.equal((await call('/v1/spaces/off/agents/requests', { ...off, method: 'POST', body: { name: 'Claude' } })).status, 403);
	assert.equal((await call('/v1/spaces/off/agents', { ...off, as: 'ada' })).status, 403);
	assert.equal((await call('/v1/spaces/off/agent/next', { ...off, agent: token })).status, 403);
	const listed = await call('/v1/spaces/off', { ...off, agent: token });
	assert.deepEqual([listed.status, listed.body.error], [403, 'Agents are turned off for this space.']);
	// People still comment there.
	assert.equal((await call('/v1/spaces/off', { ...off, as: 'ada' })).status, 200);
});

test('an agent writes as itself, with the person who added it', async () => {
	const { call, start, join } = setup();
	await start();
	const { token, agent } = await join('Claude', 'ada');
	const added = { agent: { addedBy: { sub: 'user-ada', name: 'Ada Example' } } };

	const snapshot = await call('/v1/spaces/app', { agent: token });
	assert.deepEqual(snapshot.body.viewer, { sub: `agent:${agent.id}`, name: 'Claude', ...added });
	const reply = await call('/v1/spaces/app/threads/1/comments', { agent: token, method: 'POST', body: { body: 'On it' } });
	assert.equal(reply.status, 201);
	assert.deepEqual(reply.body.thread.comments[1].author, { sub: `agent:${agent.id}`, name: 'Claude', ...added });
	await call('/v1/spaces/app/threads/1', { agent: token, method: 'PATCH', body: { resolved: true } });

	const seen = (await call('/v1/spaces/app', { as: 'ben' })).body.threads[0];
	assert.deepEqual(seen.comments[1].author.agent, added.agent);
	assert.deepEqual(seen.resolvedBy, { sub: `agent:${agent.id}`, name: 'Claude', ...added });
	// People stay people.
	assert.equal(seen.comments[0].author.agent, undefined);
});

test('only people let agents in, and a caller is a person or an agent, not both', async () => {
	const { call, join } = setup();
	const { token } = await join();
	const asked = await call('/v1/spaces/app/agents/requests', { method: 'POST', body: { name: 'Another' } });
	const path = `/v1/spaces/app/agents/requests/${asked.body.id}`;
	assert.equal((await call(`${path}/approve`, { agent: token, method: 'POST' })).status, 403);
	assert.equal((await call(path, { agent: token })).status, 403);
	assert.equal((await call(path, { agent: token, method: 'DELETE' })).status, 403);
	assert.equal((await call('/v1/spaces/app', { as: 'ada', agent: token })).status, 400);
	assert.equal((await call('/v1/spaces/app', { agent: 'vca_made-up' })).status, 401);
	assert.equal((await call('/v1/spaces/app', { agent: 'not-a-token' })).status, 401);
});

test('a removed agent is refused at once; agents only remove themselves', async () => {
	const { call, start, join, stream } = setup();
	await start();
	const claude = await join('Claude');
	const codex = await join('Codex');
	await call('/v1/spaces/app/threads/1/comments', { agent: claude.token, method: 'POST', body: { body: 'Done' } });

	assert.equal((await call(`/v1/spaces/app/agents/${claude.agent.id}`, { agent: codex.token, method: 'DELETE' })).status, 403);
	assert.deepEqual((await call(`/v1/spaces/app/agents/${codex.agent.id}`, { agent: codex.token, method: 'DELETE' })).body, {
		deleted: codex.agent.id
	});
	assert.equal((await call('/v1/spaces/app', { agent: codex.token })).status, 401);

	// A person removes another; its open requests end.
	const events = await stream({ agent: claude.token });
	const inbox = call('/v1/spaces/app/agent/next', { agent: claude.token });
	await sleep(20);
	assert.equal((await call(`/v1/spaces/app/agents/${claude.agent.id}`, { as: 'ben', method: 'DELETE' })).status, 200);
	assert.equal(await events.ended(), true);
	const ended = await inbox;
	assert.deepEqual([ended.status, ended.body.error], [401, 'This agent was removed, or its token has expired.']);
	assert.equal((await call('/v1/spaces/app', { agent: claude.token })).status, 401);
	assert.equal((await call(`/v1/spaces/app/agents/${claude.agent.id}`, { as: 'ben', method: 'DELETE' })).status, 404);
	assert.deepEqual((await call('/v1/spaces/app/agents', { as: 'ada' })).body, { agents: [] });
	// What it wrote stays, still as an agent's.
	const thread = (await call('/v1/spaces/app', { as: 'ada' })).body.threads[0];
	assert.equal(thread.comments[1].author.agent.addedBy.sub, 'user-ada');
});

test('an agent’s token expires when it goes unused for 30 days', async () => {
	const { store, join } = setup();
	const { token, agent } = await join();
	const day = 24 * 60 * 60 * 1000;
	assert.equal(store.agentByToken('app', token, Date.now() + 29 * day)?.id, agent.id);
	// That use moved the expiry on.
	assert.equal(store.agentByToken('app', token, Date.now() + 58 * day)?.id, agent.id);
	assert.equal(store.agentByToken('app', token, Date.now() + 89 * day), undefined);
});

test('the inbox answers threads with something new from others, once', async () => {
	const { call, start, join } = setup();
	await start('ada', 'Before the agent');
	const { token } = await join();
	assert.equal((await call('/v1/spaces/app/agent/next', { as: 'ada' })).status, 403);

	// What was there before the agent joined is read already. Arriving, the agent is present, viewing.
	const empty = await call('/v1/spaces/app/agent/next?wait=0', { agent: token });
	assert.deepEqual(empty.body.threads, []);
	assert.deepEqual(empty.body.participants.map((p: { id: string; state: string; author: { name: string } }) => [p.author.name, p.state]), [['Claude', 'viewing']]);

	// The inbox wakes on a new comment.
	const waiting = call('/v1/spaces/app/agent/next', { agent: token });
	await sleep(20);
	await start('ben', 'Make the table denser');
	const next = await waiting;
	assert.equal(next.status, 200);
	assert.deepEqual(next.body.threads.map((thread: { id: number }) => thread.id), [2]);
	assert.equal(next.body.threads[0].comments[0].body, 'Make the table denser');

	// Its own comments and threads are not news to it.
	await call('/v1/spaces/app/threads/2/comments', { agent: token, method: 'POST', body: { body: 'Done' } });
	await call('/v1/spaces/app/threads', {
		agent: token, method: 'POST', body: { page: `${site}/`, url: `${site}/`, surface: '', title: '', x: 1, y: 1, body: 'Note' }
	});
	const started = Date.now();
	const timedOut = await call('/v1/spaces/app/agent/next?wait=50', { agent: token });
	assert.deepEqual(timedOut.body.threads, []);
	// `wait` is capped (here at the test's 400 ms).
	assert.ok(Date.now() - started >= 350);

	await call('/v1/spaces/app/threads/1/comments', { as: 'ben', method: 'POST', body: { body: 'And this one' } });
	await call('/v1/spaces/app/threads/2/comments', { as: 'ada', method: 'POST', body: { body: 'Thanks' } });
	const both = await call('/v1/spaces/app/agent/next?wait=0', { agent: token });
	assert.deepEqual(both.body.threads.map((thread: { id: number }) => thread.id), [1, 2]);
	assert.equal((await call('/v1/spaces/app/agent/next?wait=abc', { agent: token })).status, 400);
});

test('the inbox holds back a thread while its last author is still typing in it', async () => {
	const { call, start, join, stream } = setup({ typingMs: 200 });
	const { token } = await join();
	const ada = await stream({ as: 'ada' });
	await call('/v1/spaces/app/presence', { as: 'ada', method: 'POST', body: { connection: ada.connection, state: 'typing', thread: 1 } });
	await start('ada', 'First part');
	const started = Date.now();
	const next = await call('/v1/spaces/app/agent/next', { agent: token });
	// Delivered when typing fell back to viewing.
	assert.ok(Date.now() - started >= 150);
	assert.deepEqual(next.body.threads.map((thread: { id: number }) => thread.id), [1]);
	ada.close();
});

test('people are present while their event stream is open, and set what they do', async () => {
	const { call, stream } = setup();
	const ada = await stream({ as: 'ada' });
	const first = await ada.presence((participants) => participants.length === 1);
	assert.deepEqual(first, [{
		id: ada.connection,
		// Never the email.
		author: { sub: 'user-ada', name: 'Ada Example', picture: 'https://images.example/ada.png' },
		state: 'viewing',
		since: first[0].since
	}]);

	const ben = await stream({ as: 'ben' });
	await ada.presence((participants) => participants.length === 2);

	const presence = (as: Person, body: unknown) => call('/v1/spaces/app/presence', { as, method: 'POST', body });
	assert.equal((await presence('ada', { connection: ada.connection, state: 'viewing', page: `${site}/`, surface: 'frame-1' })).status, 204);
	let mine = (await ben.presence((list) => list.some((p) => p.surface === 'frame-1'))).find((p) => p.id === ada.connection)!;
	assert.deepEqual([mine.page, mine.since], [`${site}/`, first[0].since]);

	// Nobody speaks for another’s connection.
	assert.equal((await presence('ben', { connection: ada.connection, state: 'typing' })).status, 404);
	assert.equal((await presence('ada', { connection: 'closed', state: 'typing' })).status, 404);
	assert.equal((await presence('ada', { state: 'typing' })).status, 400);
	assert.equal((await presence('ada', { connection: ada.connection, key: 'x', state: 'typing' })).status, 400);
	assert.equal((await presence('ada', { connection: ada.connection, state: 'gone' })).status, 400);
	assert.equal((await presence('ada', { connection: ada.connection, state: 'viewing', note: 'x'.repeat(201) })).status, 400);
	assert.equal((await presence('ada', { connection: ada.connection, state: 'viewing', thread: 0 })).status, 400);

	// Typing falls back to viewing; omitted fields are cleared.
	await presence('ada', { connection: ada.connection, state: 'typing', thread: 3 });
	mine = (await ben.presence((list) => list.some((p) => p.state === 'typing'))).find((p) => p.id === ada.connection)!;
	assert.deepEqual([mine.thread, mine.surface], [3, undefined]);
	assert.ok(mine.since >= first[0].since);
	await ben.presence((list) => list.find((p) => p.id === ada.connection)?.state === 'viewing');

	ada.close();
	assert.deepEqual((await ben.presence((list) => list.length === 1)).map((p) => p.id), [ben.connection]);
	assert.equal((await presence('ada', { connection: ada.connection, state: 'viewing' })).status, 404);
	ben.close();
});

test('an agent is present per key while it keeps making requests', async () => {
	const { call, join, stream } = setup();
	const { token, agent } = await join();
	const ben = await stream({ as: 'ben' });
	const presence = (body: unknown) => call('/v1/spaces/app/presence', { agent: token, method: 'POST', body });

	assert.equal((await presence({ connection: ben.connection, state: 'working' })).status, 400);
	assert.equal((await presence({ key: '7', state: 'working', thread: 7, surface: 'frame-2', note: 'Tightening the table' })).status, 204);
	assert.equal((await presence({ state: 'viewing', page: `${site}/` })).status, 204);
	const both = await ben.presence((list) => list.length === 3);
	const working = both.find((p) => p.id === `agent:${agent.id}:7`)!;
	assert.deepEqual(working.author, { sub: `agent:${agent.id}`, name: 'Claude', agent: { addedBy: { sub: 'user-ada', name: 'Ada Example' } } });
	assert.deepEqual([working.state, working.thread, working.surface, working.note], ['working', 7, 'frame-2', 'Tightening the table']);
	assert.ok(both.some((p) => p.id === `agent:${agent.id}:`));

	assert.equal((await presence({ key: '7', state: 'gone' })).status, 204);
	await ben.presence((list) => list.length === 2 && !list.some((p) => p.id === `agent:${agent.id}:7`));

	// An open inbox keeps it present past the grace after its last request (here 250 ms; the inbox holds 400).
	const inbox = await call('/v1/spaces/app/agent/next?wait=50', { agent: token });
	assert.deepEqual(inbox.body.participants.map((p: Participant) => p.id).sort(), [`agent:${agent.id}:`, ben.connection].sort());
	// Then it goes, with all its participants.
	await ben.presence((list) => list.length === 1);
	ben.close();
});
