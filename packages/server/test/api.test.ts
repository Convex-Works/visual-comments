import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createApp } from '../src/app.ts';
import { Spaces } from '../src/spaces.ts';
import { CommentStore } from '../src/store.ts';
import { USER_HEADER } from '../../client/src/lib/shared/protocol.ts';

const site = 'https://app.example';
const server = 'https://comments.example';
const secrets = { app: 'app-secret-for-tests-only-0123456789', other: 'other-secret-for-tests-only-0123456789' };
const people = {
	ada: { sub: 'user-ada', name: 'Ada Example', email: 'ada@example.com', picture: 'https://images.example/ada.png' },
	ben: { sub: 'user-ben', name: 'Ben Example', email: 'ben@example.com' }
};
type Person = keyof typeof people;
const spaces = Spaces.parse({
	app: { name: 'App', secret: secrets.app },
	other: { name: 'Other', secret: secrets.other }
});
const stores: CommentStore[] = [];
after(() => { for (const store of stores) store.close(); });

function setup(database = ':memory:') {
	const store = new CommentStore(database);
	stores.push(store);
	const app = createApp({ store, spaces });
	/** What a site's server sends: the space's secret and who is signed in. */
	const headers = (as?: Person, space: keyof typeof secrets = 'app') => ({
		authorization: `Bearer ${secrets[space]}`,
		...(as ? { [USER_HEADER]: Buffer.from(JSON.stringify(people[as])).toString('base64url') } : {})
	});
	const call = async (path: string, { as, method = 'GET', body, headers: extra = {}, space = 'app' }:
		{ as?: Person; method?: string; body?: unknown; headers?: Record<string, string>; space?: keyof typeof secrets } = {}) => {
		const response = await app(new Request(new URL(path, server), {
			method,
			headers: {
				...headers(as, space),
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
				...extra
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		}));
		return { status: response.status, body: await response.json().catch(() => null), headers: response.headers };
	};
	const place = { page: `${site}/overview`, url: `${site}/overview?tab=2#top`, surface: '', title: 'Overview' };
	const start = (as: Person = 'ada', body = 'Tighten this heading') =>
		call('/v1/spaces/app/threads', { as, method: 'POST', body: { ...place, x: 120.04, y: 48, body } });
	return { store, app, call, start, headers, place };
}

test('a thread starts with its first comment and is read by its author', async () => {
	const { call, start } = setup();
	const { status, body } = await start();
	assert.equal(status, 201);
	assert.equal(body.thread.id, 1);
	assert.deepEqual([body.thread.page, body.thread.surface, body.thread.x, body.thread.y], [`${site}/overview`, '', 120, 48]);
	// The address is kept without its fragment.
	assert.equal(body.thread.url, `${site}/overview?tab=2`);
	assert.equal(body.thread.comments[0].body, 'Tighten this heading');
	assert.deepEqual(body.thread.comments[0].author, { sub: 'user-ada', name: 'Ada Example', picture: 'https://images.example/ada.png' });
	assert.equal(body.thread.unread, false);

	const list = await call('/v1/spaces/app', { as: 'ben' });
	assert.deepEqual(list.body.space, { id: 'app', name: 'App' });
	assert.equal(list.body.threads.length, 1);
	assert.equal(list.body.threads[0].unread, true);
	assert.deepEqual(list.body.viewer, people.ben);
});

test('signed-out viewers see nothing and cannot write', async () => {
	const { call, start, place } = setup();
	await start();
	assert.deepEqual((await call('/v1/spaces/app')).body, { space: { id: 'app', name: 'App' }, viewer: null, threads: [] });
	assert.equal((await call('/v1/spaces/app/events')).status, 401);
	const post = await call('/v1/spaces/app/threads', { method: 'POST', body: { ...place, x: 1, y: 1, body: 'x' } });
	assert.equal(post.status, 401);
});

test('only a site’s server with the space’s secret can call it', async () => {
	const { call } = setup();
	const wrong = await call('/v1/spaces/app', { as: 'ada', headers: { authorization: `Bearer ${secrets.other}` } });
	assert.equal(wrong.status, 401);
	assert.equal((await call('/v1/spaces/app', { as: 'ada', headers: { authorization: '' } })).status, 401);
	// An unknown space gets the same answer as a wrong secret.
	assert.deepEqual(await call('/v1/spaces/nowhere', { as: 'ada' }).then((r) => [r.status, r.body]), [wrong.status, wrong.body]);
	// No CORS: browsers never call the server directly.
	assert.equal(wrong.headers.get('access-control-allow-origin'), null);
});

test('the site says who is signed in; an invalid user is refused', async () => {
	const { call } = setup();
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
	assert.equal((await call('/v1/spaces/app', { headers: { [USER_HEADER]: 'not base64 json' } })).status, 400);
	assert.equal((await call('/v1/spaces/app', { headers: { [USER_HEADER]: encode({ sub: 'x' }) } })).status, 400);
	const insecure = await call('/v1/spaces/app', { headers: { [USER_HEADER]: encode({ sub: 'x', name: 'X', picture: 'http://images.example/x.png' }) } });
	assert.deepEqual(insecure.body.viewer, { sub: 'x', name: 'X' });
});

test('spaces keep their threads, and their people, apart', async () => {
	const { call, start } = setup();
	await start();
	const own = await call('/v1/spaces/other', { as: 'ada', space: 'other' });
	assert.equal(own.body.viewer.sub, 'user-ada');
	assert.deepEqual(own.body.threads, []);
	// Another site renaming the same id in its own space does not rename the author here.
	const renamed = { ...people.ada, name: 'Not Ada' };
	await call('/v1/spaces/other/threads', {
		space: 'other', method: 'POST', headers: { [USER_HEADER]: Buffer.from(JSON.stringify(renamed)).toString('base64url') },
		body: { page: 'p', url: 'https://other.example/', surface: '', title: '', x: 1, y: 1, body: 'Elsewhere' }
	});
	const list = await call('/v1/spaces/app', { as: 'ben' });
	assert.equal(list.body.threads[0].comments[0].author.name, 'Ada Example');
});

test('writes must be JSON', async () => {
	const { call, place } = setup();
	const sent = await call('/v1/spaces/app/threads', {
		as: 'ada', method: 'POST', body: { ...place, x: 1, y: 1, body: 'Hello' }, headers: { 'content-type': 'text/plain' }
	});
	assert.equal(sent.status, 415);
});

test('rejects invalid pages, positions and bodies', async () => {
	const { call, place } = setup();
	const post = (body: Record<string, unknown>) => call('/v1/spaces/app/threads', { as: 'ada', method: 'POST', body: { ...place, ...body } });
	assert.equal((await post({ page: '', x: 1, y: 1, body: 'x' })).status, 400);
	assert.equal((await post({ x: -1, y: 1, body: 'x' })).status, 400);
	assert.equal((await post({ x: 1, y: 'far', body: 'x' })).status, 400);
	assert.equal((await post({ x: 1, y: 1, body: '   ' })).status, 400);
	assert.equal((await post({ x: 1, y: 1, body: 'x'.repeat(5001) })).status, 413);
	assert.equal((await post({ url: 'javascript:alert(1)', x: 1, y: 1, body: 'x' })).status, 400);
});

test('a thread keeps its surface, its element and what the host said about the place', async () => {
	const { call, place } = setup();
	const anchor = {
		selector: 'body > main > button:nth-of-type(2)', label: 'button “Add prompts”', text: 'Add prompts',
		x: 100.04, y: 40, width: 96, height: 32, extra: 'dropped'
	};
	const created = await call('/v1/spaces/app/threads', {
		as: 'ada', method: 'POST',
		body: {
			...place, surface: 'overview', title: 'Overview frame', x: 120, y: 48, anchor, body: 'Rename this',
			context: { viewport: '1440×900', flow: 'Onboarding', nested: { no: 1 }, 'bad key!': 'x' }
		}
	});
	assert.equal(created.status, 201);
	const { thread } = created.body;
	assert.equal(thread.surface, 'overview');
	assert.equal(thread.title, 'Overview frame');
	assert.deepEqual(thread.anchor, {
		selector: anchor.selector, label: anchor.label, text: anchor.text, x: 100, y: 40, width: 96, height: 32
	});
	assert.deepEqual(thread.context, { viewport: '1440×900', flow: 'Onboarding' });
	const open = await call('/v1/spaces/app/threads', { as: 'ada', method: 'POST', body: { ...place, x: 10, y: 10, body: 'Anywhere' } });
	assert.equal(open.body.thread.anchor, null);
	const invalid = await call('/v1/spaces/app/threads', {
		as: 'ada', method: 'POST', body: { ...place, x: 10, y: 10, anchor: { label: 'button' }, body: 'Bad' }
	});
	assert.equal(invalid.status, 400);
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function upload(context: ReturnType<typeof setup>, as: Person | undefined, bytes: Uint8Array<ArrayBuffer>, type = 'image/png', query = '?width=40&height=30') {
	const response = await context.app(new Request(new URL(`/v1/spaces/app/images${query}`, server), {
		method: 'POST',
		headers: { ...context.headers(as), 'content-type': type },
		body: bytes
	}));
	return { status: response.status, body: await response.json() };
}

async function image(context: ReturnType<typeof setup>, path: string, as: Person | null = 'ben', space: keyof typeof secrets = 'app') {
	const response = await context.app(new Request(new URL(path, server), { headers: context.headers(as ?? undefined, space) }));
	return { status: response.status, headers: response.headers, bytes: response.ok ? new Uint8Array(await response.arrayBuffer()) : null };
}

test('images upload first, then belong to the comment they are sent with', async () => {
	const context = setup();
	const { call, place } = context;
	const uploaded = await upload(context, 'ada', PNG);
	assert.equal(uploaded.status, 201);
	const { id, key } = uploaded.body.image;
	assert.deepEqual(uploaded.body.image, { id: 1, key, width: 40, height: 30 });

	const created = await call('/v1/spaces/app/threads', { as: 'ada', method: 'POST', body: { ...place, x: 1, y: 1, images: [id] } });
	assert.equal(created.status, 201);
	assert.equal(created.body.thread.comments[0].body, '');
	assert.deepEqual(created.body.thread.comments[0].images, [{ id, key, width: 40, height: 30 }]);

	// Signed-in people of the space see it, through the site's server.
	const read = await image(context, `/v1/spaces/app/images/${id}/${key}`);
	assert.equal(read.status, 200);
	assert.deepEqual(read.bytes, PNG);
	assert.equal(read.headers.get('content-type'), 'image/png');
	assert.equal(read.headers.get('x-content-type-options'), 'nosniff');
	assert.match(read.headers.get('cache-control')!, /^private/);
	assert.equal((await image(context, `/v1/spaces/app/images/${id}/wrong-key-123`)).status, 404);
	assert.equal((await image(context, `/v1/spaces/app/images/${id}/${key}`, null)).status, 401);
	assert.equal((await image(context, `/v1/spaces/other/images/${id}/${key}`, 'ben', 'other')).status, 404);

	// Someone else's upload, or one already sent, cannot be attached again.
	const stolen = await call('/v1/spaces/app/threads/1/comments', { as: 'ben', method: 'POST', body: { images: [id] } });
	assert.equal(stolen.status, 400);
});

test('editing a comment can drop its images, and deleting it deletes them', async () => {
	const context = setup();
	const { call, place } = context;
	const first = (await upload(context, 'ada', PNG)).body.image;
	const second = (await upload(context, 'ada', PNG)).body.image;
	await call('/v1/spaces/app/threads', { as: 'ada', method: 'POST', body: { ...place, x: 1, y: 1, body: 'Two', images: [first.id, second.id] } });
	const edited = await call('/v1/spaces/app/comments/1', { as: 'ada', method: 'PATCH', body: { body: 'One', images: [second.id] } });
	assert.deepEqual(edited.body.thread.comments[0].images.map((i: { id: number }) => i.id), [second.id]);
	assert.equal((await image(context, `/v1/spaces/app/images/${first.id}/${first.key}`)).status, 404);
	const emptied = await call('/v1/spaces/app/comments/1', { as: 'ada', method: 'PATCH', body: { body: '', images: [] } });
	assert.equal(emptied.status, 400);
	await call('/v1/spaces/app/comments/1', { as: 'ada', method: 'DELETE' });
	assert.equal((await image(context, `/v1/spaces/app/images/${second.id}/${second.key}`)).status, 404);
});

test('only real PNG, JPEG, GIF and WebP images are accepted', async () => {
	const context = setup();
	const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
	assert.equal((await upload(context, 'ada', svg, 'image/svg+xml')).status, 415);
	assert.equal((await upload(context, 'ada', svg, 'image/png')).status, 415);
	assert.equal((await upload(context, 'ada', PNG, 'image/png', '?width=0&height=30')).status, 400);
	assert.equal((await upload(context, undefined, PNG)).status, 401);
	const big = new Uint8Array(10 * 1024 * 1024 + 1);
	big.set(PNG);
	assert.equal((await upload(context, 'ada', big)).status, 413);
});

test('replies mark the thread unread for others and reopen a resolved thread', async () => {
	const { call, start } = setup();
	await start();
	const resolved = await call('/v1/spaces/app/threads/1', { as: 'ben', method: 'PATCH', body: { resolved: true } });
	assert.equal(resolved.body.thread.resolvedBy.name, 'Ben Example');
	const reply = await call('/v1/spaces/app/threads/1/comments', { as: 'ben', method: 'POST', body: { body: 'Done\r\nsee v2' } });
	assert.equal(reply.status, 201);
	assert.equal(reply.body.thread.resolvedAt, null);
	assert.equal(reply.body.thread.comments[1].body, 'Done\nsee v2');

	assert.equal((await call('/v1/spaces/app', { as: 'ada' })).body.threads[0].unread, true);
	await call('/v1/spaces/app/threads/1/read', { as: 'ada', method: 'POST', body: { read: true } });
	assert.equal((await call('/v1/spaces/app', { as: 'ada' })).body.threads[0].unread, false);
	await call('/v1/spaces/app/threads/1/read', { as: 'ada', method: 'POST', body: { read: false } });
	assert.equal((await call('/v1/spaces/app', { as: 'ada' })).body.threads[0].unread, true);
});

test('only authors edit or delete their comments; deleting the first comment deletes the thread', async () => {
	const { call, start } = setup();
	await start();
	await call('/v1/spaces/app/threads/1/comments', { as: 'ben', method: 'POST', body: { body: 'Agreed' } });
	assert.equal((await call('/v1/spaces/app/comments/1', { as: 'ben', method: 'PATCH', body: { body: 'Hijack' } })).status, 403);
	assert.equal((await call('/v1/spaces/app/threads/1', { as: 'ben', method: 'DELETE' })).status, 403);

	const edited = await call('/v1/spaces/app/comments/1', { as: 'ada', method: 'PATCH', body: { body: 'Tighten the heading' } });
	assert.equal(edited.body.thread.comments[0].body, 'Tighten the heading');
	assert.ok(edited.body.thread.comments[0].editedAt);

	const reply = await call('/v1/spaces/app/comments/2', { as: 'ben', method: 'DELETE' });
	assert.equal(reply.body.thread.comments.length, 1);
	assert.deepEqual((await call('/v1/spaces/app/comments/1', { as: 'ada', method: 'DELETE' })).body, { deleted: 1 });
	assert.equal((await call('/v1/spaces/app', { as: 'ada' })).body.threads.length, 0);
	assert.equal((await call('/v1/spaces/app/threads/1/comments', { as: 'ben', method: 'POST', body: { body: 'Late' } })).status, 404);
});

test('a comment can only be changed through its own space', async () => {
	const { call, start } = setup();
	await start();
	const across = await call('/v1/spaces/other/comments/1', {
		as: 'ada', space: 'other', method: 'PATCH', body: { body: 'From elsewhere' }
	});
	assert.equal(across.status, 404);
});

test('thread numbers count per space and are never reused', async () => {
	const { call, start, place } = setup();
	await start();
	await start();
	await call('/v1/spaces/app/threads/2', { as: 'ada', method: 'DELETE' });
	assert.equal((await start()).body.thread.id, 3);
	const other = await call('/v1/spaces/other/threads', {
		as: 'ada', space: 'other', method: 'POST',
		body: { ...place, url: 'https://other.example/', x: 1, y: 1, body: 'First here' }
	});
	assert.equal(other.body.thread.id, 1);
});

test('the event stream announces every write in its space', async () => {
	const context = setup();
	const controller = new AbortController();
	const response = await context.app(new Request(new URL('/v1/spaces/app/events', server), {
		headers: context.headers('ben'), signal: controller.signal
	}));
	assert.equal(response.headers.get('content-type'), 'text/event-stream');
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	assert.match(decoder.decode((await reader.read()).value), /^retry:/);
	assert.match(decoder.decode((await reader.read()).value), /^event: hello/);
	assert.match(decoder.decode((await reader.read()).value), /^event: presence/);
	await context.start();
	assert.match(decoder.decode((await reader.read()).value), /^event: change/);
	controller.abort();
	// Any presence event already queued, then the end.
	while (!(await reader.read()).done);
});

test('threads persist in the SQLite file across restarts', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'visual-comments-'));
	try {
		const database = join(dir, 'nested', 'comments.sqlite');
		const first = setup(database);
		await first.start();
		first.store.close();
		const second = setup(database);
		const list = await second.call('/v1/spaces/app', { as: 'ben' });
		assert.equal(list.body.threads[0].comments[0].body, 'Tighten this heading');
		second.store.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a closed store leaves every comment in the database file, not in the WAL', () => {
	const dir = mkdtempSync(join(tmpdir(), 'visual-comments-'));
	try {
		const database = join(dir, 'comments.sqlite');
		const module = new URL('../src/store.ts', import.meta.url).href;
		execFileSync(process.execPath, ['--input-type=module', '-e', `
			const { existsSync } = await import('node:fs');
			const { CommentStore } = await import(${JSON.stringify(module)});
			const store = new CommentStore(${JSON.stringify(database)});
			process.once('exit', () => store.close());
			store.createThread('app', { sub: 'user-ada', name: 'Ada' }, { page: 'p', url: 'https://app.example/', surface: '', title: '', x: 1, y: 1, body: 'Kept', anchor: null, context: {}, images: [] });
			// While open, the write is in the WAL.
			process.exit(existsSync(${JSON.stringify(`${database}-wal`)}) ? 0 : 2);
		`], { stdio: 'pipe' });
		assert.equal(existsSync(`${database}-wal`), false);
		const reopened = new CommentStore(database);
		assert.equal(reopened.list('app', null)[0].comments[0].body, 'Kept');
		reopened.close();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('a database file deleted or replaced while open is refused, not written to', async () => {
	const dir = mkdtempSync(join(tmpdir(), 'visual-comments-'));
	try {
		const database = join(dir, 'comments.sqlite');
		const { call, start } = setup(database);
		assert.equal((await start()).status, 201);
		copyFileSync(database, join(dir, 'copy.sqlite'));

		// Replaced, as by a restore over a running server.
		renameSync(join(dir, 'copy.sqlite'), database);
		const replaced = await start();
		assert.equal(replaced.status, 503);
		assert.match(replaced.body.error, /deleted or replaced/);

		// Deleted.
		rmSync(database);
		assert.equal((await start()).status, 503);
		assert.equal((await call('/v1/spaces/app/threads/1/comments', { as: 'ada', method: 'POST', body: { body: 'x' } })).status, 503);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
