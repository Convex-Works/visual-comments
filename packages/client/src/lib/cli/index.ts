#!/usr/bin/env node
/// <reference types="node" />
// The `visual-comments` command, for coding agents: join a site's comment space
// once a person allows it, wait for new comments, reply, and say what you are
// doing. It talks only to the site's comments route (`/_comments`), with the
// agent's token. Node built-ins only, and compiled, because Node does not strip
// types in node_modules.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import type { Agent, AgentInbox, CommentImage, CommentThread, NewAgentRequest, PresenceUpdate } from '../shared/types.js';

const DEFAULT_PATH = '/_comments';
/** The server holds `/agent/next` and the token request up to 50 s; give it room. */
const LONG_POLL_MS = 80_000;
const REQUEST_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;
const IMAGE_EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

const HELP: Record<string, string> = {
	main: `Usage: visual-comments <command> [options]

Lets a coding agent take part in a site's comments. A person allows it once in
the browser; then it waits for new comments, replies, and shows what it is doing.

Commands:
  connect <site>     Ask to join the site's comments, and wait for a person to allow it.
  next               Wait for new comments; print them as JSON.
  reply <thread>     Reply in a thread, with --body or stdin.
  presence <state>   Say what you are doing: viewing, working or gone.
  agents             List the space's agents.
  disconnect         Leave the space and forget the token.

Options:
  --site <site>      Which connected site, when there are several. Or set VISUAL_COMMENTS_SITE.
  -h, --help         Help for a command: visual-comments <command> --help

Tokens are kept in \${XDG_CONFIG_HOME:-~/.config}/visual-comments/agents.json.
Exit codes: 0 done, 1 error, 2 not connected or the token was rejected.`,

	connect: `Usage: visual-comments connect <site> [--name <name>] [--path <path>]

Asks to join the site's comments, prints the address where a person allows it
(and opens it in the browser), waits, then saves the token.

  --name <name>   The name people see on your comments. Default "Agent".
  --path <path>   Where the site answers comment requests. Default /_comments.

Example: visual-comments connect http://localhost:5173 --name Claude`,

	next: `Usage: visual-comments next [--site <site>]

Waits, as long as it takes, until a thread has something new for you, then
prints { site, threads, participants } as JSON and exits. The threads are then
read for you. Images are downloaded; each gets a "path". Network errors are
retried. Run it again at once to keep listening.`,

	reply: `Usage: visual-comments reply <thread> [--body <text>] [--site <site>]

Replies in thread #<thread>. Without --body, the text is read from stdin.
Prints { thread: { id, url, comment } }.

Example: echo "Done: the table is tighter." | visual-comments reply 12`,

	presence: `Usage: visual-comments presence <viewing|working|gone> [options]

Says what you are doing, for everyone in the space to see. Each update states
the whole presence: options left out are cleared.

  --key <key>       One presence per key, to work on several things at once. Default "".
  --thread <n>      The thread it is about.
  --surface <id>    The surface (e.g. a frame) it is about.
  --page <page>     The page it is about.
  --note <text>     What you are doing, e.g. "Tightening the table".
  --site <site>     Which connected site.

Example: visual-comments presence working --key 12 --thread 12 --note "Tightening the table"
         visual-comments presence gone --key 12`,

	agents: `Usage: visual-comments agents [--site <site>]

Prints the space's agents as JSON: { site, me, agents }.`,

	disconnect: `Usage: visual-comments disconnect [--site <site>]

Removes you from the space and forgets the token.`
};

interface Saved {
	token: string;
	agent: Agent;
}

/** Ends the command with a message and an exit code. */
class CliError extends Error {
	code: number;
	constructor(code: number, message: string) {
		super(message);
		this.code = code;
	}
}

/** A failed request. Status 0 when the site could not be reached. */
class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

const log = (message: string) => process.stderr.write(`${message}\n`);
/** Asked for, so on stdout; usage errors go to stderr. */
const help = (text: string) => process.stdout.write(`${text}\n`);
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

function parse<T extends ParseArgsOptionsConfig>(command: string, args: string[], options: T) {
	try {
		return parseArgs({ args, options: { ...options, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
	} catch (error) {
		throw new CliError(1, `${(error as Error).message}\n\n${HELP[command]}`);
	}
}

// Sites and saved tokens

/** A site as typed: `localhost:5173` works too. */
function siteUrl(site: string): URL {
	const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(site)
		? site
		: `${/^(localhost|127\.|\[::1\])/.test(site) ? 'http' : 'https'}://${site}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol === 'http:' || url.protocol === 'https:') return url;
	} catch { /* below */ }
	throw new CliError(1, `"${site}" is not a web address.`);
}

/** The site, with any path, and where it answers comment requests: `<origin><path>`, which keys the saved token. */
function locate(site: string, path = DEFAULT_PATH) {
	const url = siteUrl(site);
	const route = `/${path.replace(/^\/+|\/+$/g, '')}`;
	return { site: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, endpoint: `${url.origin}${route === '/' ? '' : route}` };
}

function credentialsFile(): string {
	return join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'visual-comments', 'agents.json');
}

function loadAll(): Record<string, Saved> {
	const file = credentialsFile();
	try {
		return JSON.parse(readFileSync(file, 'utf8'));
	} catch (error) {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
		throw new CliError(1, `${file} cannot be read: ${(error as Error).message}`);
	}
}

function saveAll(all: Record<string, Saved>) {
	const file = credentialsFile();
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	// Written whole, then moved over the old file, so a crash never leaves half of it. Only you can read it.
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(all, null, '\t')}\n`, { mode: 0o600 });
	renameSync(temporary, file);
}

/** The site the command is for, when it is connected. Set for the hint on a rejected token. */
let current: { endpoint: string; site: string; saved: Saved } | undefined;

function connected(site: string | undefined): NonNullable<typeof current> {
	const all = loadAll();
	const endpoints = Object.keys(all);
	const wanted = site ?? process.env.VISUAL_COMMENTS_SITE;
	let matches = endpoints;
	if (wanted) {
		const url = siteUrl(wanted);
		const exact = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
		matches = endpoints.filter((endpoint) => endpoint === exact);
		if (!matches.length) matches = endpoints.filter((endpoint) => new URL(endpoint).origin === url.origin);
		if (!matches.length) throw new CliError(2, `Not connected to ${wanted}. Run: visual-comments connect ${wanted}`);
	} else if (!matches.length) {
		throw new CliError(2, 'Not connected to any site. Run: visual-comments connect <site>');
	}
	if (matches.length > 1) {
		throw new CliError(1, `Connected to several sites; choose one with --site or VISUAL_COMMENTS_SITE:\n  ${matches.join('\n  ')}`);
	}
	const endpoint = matches[0];
	current = { endpoint, site: new URL(endpoint).origin, saved: all[endpoint] };
	return current;
}

// Requests

async function call<T>(
	endpoint: string,
	route: string,
	init: { method?: string; token?: string; body?: unknown; timeout?: number } = {}
): Promise<{ status: number; data: T }> {
	const headers: Record<string, string> = { accept: 'application/json' };
	if (init.token) headers.authorization = `Bearer ${init.token}`;
	if (init.body !== undefined) headers['content-type'] = 'application/json';
	let response: Response;
	let text: string;
	try {
		response = await fetch(`${endpoint}${route}`, {
			method: init.method ?? 'GET',
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: AbortSignal.timeout(init.timeout ?? REQUEST_MS)
		});
		text = await response.text();
	} catch (error) {
		throw new HttpError(0, `${endpoint} cannot be reached (${reason(error)}).`);
	}
	let data: unknown;
	try {
		data = text ? JSON.parse(text) : undefined;
	} catch {
		// HTML from the site itself, e.g. a sign-in page: the comments route is elsewhere.
		const message = `${endpoint}${route} did not answer like a comments route (status ${response.status}). Is --path right?`;
		throw new HttpError(response.ok ? 404 : response.status, message);
	}
	if (!response.ok) {
		const error = data && typeof data === 'object' && 'error' in data ? data.error : undefined;
		throw new HttpError(response.status, typeof error === 'string' ? error : `The site answered ${response.status}.`);
	}
	return { status: response.status, data: data as T };
}

function reason(error: unknown): string {
	if (error instanceof Error && error.name === 'TimeoutError') return 'no answer in time';
	if (!(error instanceof Error)) return String(error);
	// fetch fails with "fetch failed"; the cause says why, e.g. ECONNREFUSED.
	const cause: unknown = error.cause;
	if (cause instanceof Error) return 'code' in cause && typeof cause.code === 'string' ? cause.code : cause.message;
	return error.message;
}

/** Worth trying again: the site could not be reached, or had a passing problem. */
function transient(error: unknown): error is HttpError {
	return error instanceof HttpError && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
}

function backoff(previous: number): number {
	return previous ? Math.min(previous * 2, MAX_BACKOFF_MS) : 1000;
}

// Commands

async function connect(args: string[]) {
	const { values, positionals } = parse('connect', args, { name: { type: 'string' }, path: { type: 'string' } });
	if (values.help) return help(HELP.connect);
	if (positionals.length !== 1) throw new CliError(1, HELP.connect);
	const { site, endpoint } = locate(positionals[0], values.path);
	const name = (values.name ?? 'Agent').trim();
	if (!name || name.length > 60) throw new CliError(1, 'The name must be 1 to 60 characters.');

	// Joining again would add a second agent to the space; a saved token that still works is enough.
	const existing = loadAll()[endpoint];
	if (existing) {
		try {
			const { data } = await call<{ agents: Agent[] }>(endpoint, '/agents', { token: existing.token });
			const agent = data.agents.find((agent) => agent.id === existing.agent.id);
			if (agent) {
				log(`Already connected to ${site} as ${agent.name}. To join again, run visual-comments disconnect first.`);
				return print({ site, agent });
			}
		} catch (error) {
			if (!(error instanceof HttpError && error.status === 401)) throw error;
		}
	}

	const { data: request } = await call<NewAgentRequest>(endpoint, '/agents/requests', { method: 'POST', body: { name } });
	const approval = `${site}/#vc-connect=${encodeURIComponent(request.id)}`;
	log(`To let ${name} join, open\n\n  ${approval}\n\ncheck that it shows the code ${request.code}, and click Allow. Waiting…`);
	openBrowser(approval);

	// The server answers 404 once the request expires; this only ends retries against a site that stays down.
	const deadline = Date.now() + Math.max(request.expiresAt - Date.now(), 0) + 60_000;
	let delay = 0;
	while (Date.now() < deadline) {
		try {
			const { data } = await call<{ token: string; agent: Agent } | { pending: true }>(endpoint, `/agents/requests/${encodeURIComponent(request.id)}/token`, {
				method: 'POST',
				body: { secret: request.secret },
				timeout: LONG_POLL_MS
			});
			delay = 0;
			if ('token' in data) {
				saveAll({ ...loadAll(), [endpoint]: { token: data.token, agent: data.agent } });
				log(`Connected to ${site} as ${data.agent.name}, added by ${data.agent.addedBy.name}.`);
				return print({ site, agent: data.agent });
			}
		} catch (error) {
			if (error instanceof HttpError && error.status === 404) throw new CliError(1, 'The request was denied, or it expired. Run connect again.');
			if (!transient(error)) throw error;
			delay = backoff(delay);
			log(`${error.message} Trying again in ${delay / 1000} s.`);
			await sleep(delay);
		}
	}
	throw new CliError(1, 'The request expired. Run connect again.');
}

/** Best effort: the address is printed anyway. */
function openBrowser(url: string) {
	const [command, args] =
		process.platform === 'darwin' ? ['open', [url]]
		: process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
		: ['xdg-open', [url]];
	try {
		const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsVerbatimArguments: true });
		child.on('error', () => {});
		child.unref();
	} catch { /* no browser here */ }
}

async function next(args: string[]) {
	const { values } = parse('next', args, { site: { type: 'string' } });
	if (values.help) return help(HELP.next);
	const { endpoint, site, saved } = connected(values.site);
	// Each request is short; the loop is what waits, so no proxy times out a request held for hours.
	let delay = 0;
	for (;;) {
		let inbox: AgentInbox;
		try {
			({ data: inbox } = await call<AgentInbox>(endpoint, '/agent/next?wait=50', { token: saved.token, timeout: LONG_POLL_MS }));
			delay = 0;
		} catch (error) {
			if (!transient(error)) throw error;
			delay = backoff(delay);
			log(`${error.message} Trying again in ${delay / 1000} s.`);
			await sleep(delay);
			continue;
		}
		if (!inbox.threads.length) continue;
		// The threads are marked read now, so from here nothing may fail: an image that will not download keeps no path.
		await downloadImages(endpoint, saved.token, inbox.threads);
		return print({ site, threads: inbox.threads, participants: inbox.participants });
	}
}

async function downloadImages(endpoint: string, token: string, threads: CommentThread[]) {
	const host = new URL(endpoint).host;
	const folder = join(tmpdir(), 'visual-comments', process.platform === 'win32' ? host.replace(/:/g, '_') : host);
	mkdirSync(folder, { recursive: true });
	for (const comment of threads.flatMap((thread) => thread.comments)) {
		for (const image of comment.images as (CommentImage & { path?: string })[]) {
			const name = `${image.id}-${image.key}`;
			// An image's address never changes, so one downloaded before is the same image.
			const known = Object.values(IMAGE_EXTENSIONS).map((extension) => join(folder, `${name}.${extension}`)).find((path) => existsSync(path));
			if (known) {
				image.path = known;
				continue;
			}
			try {
				image.path = await downloadImage(`${endpoint}/images/${image.id}/${encodeURIComponent(image.key)}`, token, join(folder, name));
			} catch (error) {
				log(`Image ${image.id} could not be downloaded: ${(error as Error).message}`);
			}
		}
	}
}

async function downloadImage(url: string, token: string, base: string): Promise<string> {
	for (let attempt = 1; ; attempt++) {
		try {
			const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(REQUEST_MS) });
			if (!response.ok) throw new HttpError(response.status, `the site answered ${response.status}`);
			const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
			const path = `${base}.${IMAGE_EXTENSIONS[type] ?? 'bin'}`;
			writeFileSync(path, new Uint8Array(await response.arrayBuffer()));
			return path;
		} catch (error) {
			const failure = error instanceof HttpError ? error : new HttpError(0, reason(error));
			if (attempt >= 3 || !transient(failure)) throw failure;
			await sleep(1000 * attempt);
		}
	}
}

async function reply(args: string[]) {
	const { values, positionals } = parse('reply', args, { body: { type: 'string' }, site: { type: 'string' } });
	if (values.help) return help(HELP.reply);
	if (positionals.length !== 1 || !/^\d+$/.test(positionals[0].replace(/^#/, ''))) throw new CliError(1, HELP.reply);
	const number = Number(positionals[0].replace(/^#/, ''));
	const { endpoint, saved } = connected(values.site);
	const body = (values.body ?? (process.stdin.isTTY ? '' : await readStdin())).trim();
	if (!body) throw new CliError(1, 'The reply is empty. Pass --body, or the text on stdin.');
	const { data } = await call<{ thread: CommentThread }>(endpoint, `/threads/${number}/comments`, { method: 'POST', token: saved.token, body: { body } });
	print({ thread: { id: data.thread.id, url: data.thread.url, comment: data.thread.comments.at(-1)?.id } });
}

async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

async function presence(args: string[]) {
	const { values, positionals } = parse('presence', args, {
		key: { type: 'string' },
		thread: { type: 'string' },
		surface: { type: 'string' },
		page: { type: 'string' },
		note: { type: 'string' },
		site: { type: 'string' }
	});
	if (values.help) return help(HELP.presence);
	const state = positionals[0];
	if (positionals.length !== 1 || (state !== 'viewing' && state !== 'working' && state !== 'gone')) throw new CliError(1, HELP.presence);
	const update: PresenceUpdate = { state };
	if (values.key !== undefined) update.key = values.key;
	if (values.thread !== undefined) {
		const thread = Number(values.thread.replace(/^#/, ''));
		if (!Number.isInteger(thread) || thread < 1) throw new CliError(1, '--thread must be a thread number.');
		update.thread = thread;
	}
	if (values.surface !== undefined) update.surface = values.surface;
	if (values.page !== undefined) update.page = values.page;
	if (values.note !== undefined) update.note = values.note;
	const { endpoint, saved } = connected(values.site);
	await call(endpoint, '/presence', { method: 'POST', token: saved.token, body: update });
}

async function agents(args: string[]) {
	const { values } = parse('agents', args, { site: { type: 'string' } });
	if (values.help) return help(HELP.agents);
	const { endpoint, site, saved } = connected(values.site);
	const { data } = await call<{ agents: Agent[] }>(endpoint, '/agents', { token: saved.token });
	print({ site, me: saved.agent.id, agents: data.agents });
}

async function disconnect(args: string[]) {
	const { values } = parse('disconnect', args, { site: { type: 'string' } });
	if (values.help) return help(HELP.disconnect);
	const { endpoint, site, saved } = connected(values.site);
	try {
		await call(endpoint, `/agents/${encodeURIComponent(saved.agent.id)}`, { method: 'DELETE', token: saved.token });
	} catch (error) {
		// Already removed by a person, or expired: forgetting the token is all that is left.
		if (!(error instanceof HttpError && error.status === 401)) throw error;
	}
	const all = loadAll();
	delete all[endpoint];
	saveAll(all);
	log(`Disconnected from ${site}.`);
	print({ deleted: saved.agent.id });
}

const COMMANDS: Record<string, (args: string[]) => Promise<unknown>> = { connect, next, reply, presence, agents, disconnect };

async function main(argv: string[]) {
	const [command, ...args] = argv;
	if (!command || command === '-h' || command === '--help' || command === 'help') {
		help(HELP.main);
		return;
	}
	const run = COMMANDS[command];
	if (!run) throw new CliError(1, `Unknown command "${command}".\n\n${HELP.main}`);
	await run(args);
}

main(process.argv.slice(2)).catch((error: unknown) => {
	if (error instanceof CliError) {
		log(error.message);
		process.exitCode = error.code;
	} else if (error instanceof HttpError && error.status === 401 && current) {
		log(`${error.message} Run: visual-comments connect ${current.site}`);
		process.exitCode = 2;
	} else {
		log(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
});
