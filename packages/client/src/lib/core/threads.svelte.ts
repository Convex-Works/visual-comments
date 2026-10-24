import type { Api } from './api.js';
import type {
	Agent, AgentRequest, Comment, CommentImage, CommentThread, CommentsSnapshot, NewThreadInput, Participant,
	PresenceUpdate, Viewer
} from '../shared/types.js';

type Result = { thread?: CommentThread; deleted?: number };

/** What this tab says about itself; its connection is added once the event stream names it. */
export type OwnPresence = Omit<PresenceUpdate, 'connection' | 'key'>;

/**
 * The space's threads, kept current with the server's event stream. Actions
 * show their result at once and resync with the server when they fail.
 */
export class Threads {
	viewer = $state<Viewer | null>(null);
	threads = $state<CommentThread[]>([]);
	spaceName = $state('');
	loading = $state(true);
	/** A failed action, shown until dismissed. */
	error = $state<string | null>(null);
	/** Ticks every 30 seconds so relative times stay current. */
	now = $state(Date.now());
	/** This tab's event stream, as the server named it, while it is open. */
	connection = $state<string | undefined>();
	/** Everyone present in the space, this tab included, while the event stream is open. */
	participants = $state.raw<Participant[]>([]);
	/** The space's agents once listed; undefined until then, or when the space has them turned off. */
	agents = $state.raw<Agent[] | undefined>();

	private api: Api;
	private refreshing?: Promise<void>;
	private queued = false;
	private listening?: AbortController;
	private nextPending = -1;
	private presence?: OwnPresence;
	/** The last presence sent, with its connection, so an unchanged one is not sent again. */
	private posted = '';
	/** The participants as last received, so an unchanged list does not wake every listener. */
	private received = '[]';

	constructor(api: Api) {
		this.api = api;
	}

	get unreadCount(): number {
		return this.threads.filter((thread) => thread.unread && !thread.resolvedAt).length;
	}

	start() {
		void this.refresh();
		const onfocus = () => { void this.refresh(); };
		window.addEventListener('focus', onfocus);
		const timer = setInterval(() => { this.now = Date.now(); }, 30_000);
		return () => {
			window.removeEventListener('focus', onfocus);
			clearInterval(timer);
			this.stopListening();
		};
	}

	/** Coalesces overlapping refreshes into at most one more request. */
	refresh(): Promise<void> {
		if (this.refreshing) {
			this.queued = true;
			return this.refreshing;
		}
		this.refreshing = (async () => {
			try {
				const response = await this.api.fetch('');
				if (!response.ok) throw new Error();
				const snapshot = (await response.json()) as CommentsSnapshot;
				this.viewer = snapshot.viewer;
				this.spaceName = snapshot.space.name;
				// Keep replies that are still on their way to the server.
				const pending = new Map(this.threads.map((t) => [t.id, t.comments.filter((c) => c.pending)]));
				this.threads = snapshot.threads.map((thread) => {
					const waiting = pending.get(thread.id);
					return waiting?.length ? { ...thread, comments: [...thread.comments, ...waiting] } : thread;
				});
				if (this.viewer) this.listen();
				else this.stopListening();
			} catch {
				// Keep what is shown; the next event or focus retries.
			} finally {
				this.loading = false;
				this.refreshing = undefined;
				if (this.queued) {
					this.queued = false;
					void this.refresh();
				}
			}
		})();
		return this.refreshing;
	}

	private stopListening() {
		this.listening?.abort();
		this.listening = undefined;
		this.disconnected();
	}

	/** Without the stream, who is present is unknown, and the server has already let this tab go. */
	private disconnected() {
		this.connection = undefined;
		this.setParticipants([]);
	}

	private setParticipants(participants: Participant[]) {
		const json = JSON.stringify(participants);
		if (json === this.received) return;
		this.received = json;
		this.participants = participants;
	}

	/** Follows the event stream; after a dropped connection, catches up on anything missed. */
	private listen() {
		if (this.listening) return;
		const controller = new AbortController();
		this.listening = controller;
		void (async () => {
			let connected = false;
			while (!controller.signal.aborted && this.viewer) {
				try {
					const response = await this.api.fetch('/events', { signal: controller.signal });
					if (!response.ok || !response.body) break;
					if (connected) void this.refresh();
					connected = true;
					const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
					let buffer = '';
					for (;;) {
						const { value, done } = await reader.read();
						if (done) break;
						buffer += value;
						let end: number;
						while ((end = buffer.indexOf('\n\n')) !== -1) {
							this.receive(buffer.slice(0, end));
							buffer = buffer.slice(end + 2);
						}
					}
				} catch {
					// Dropped; try again shortly.
				}
				if (controller.signal.aborted) break;
				this.disconnected();
				await new Promise((done) => setTimeout(done, 3000));
			}
			if (this.listening === controller) this.listening = undefined;
		})();
	}

	/** One message of the event stream. Servers without presence send only `change`. */
	private receive(message: string) {
		const event = /^event: (.*)$/m.exec(message)?.[1];
		if (event === 'change') return void this.refresh();
		if (event !== 'hello' && event !== 'presence') return;
		let data;
		try {
			data = JSON.parse(message.match(/^data: ?(.*)$/gm)?.map((line) => line.replace(/^data: ?/, '')).join('\n') ?? '');
		} catch {
			return;
		}
		if (event === 'hello' && typeof data?.connection === 'string') {
			this.connection = data.connection;
			// A new connection is a new participant: tell the server what this tab is doing.
			void this.postPresence();
		} else if (event === 'presence' && Array.isArray(data?.participants)) {
			this.setParticipants(data.participants);
		}
	}

	/**
	 * Says what this tab is doing, unless it said so already. `again` sends it
	 * even so, as the heartbeat that keeps `typing` from lapsing.
	 */
	setPresence(presence: OwnPresence, again = false) {
		this.presence = presence;
		void this.postPresence(again);
	}

	private async postPresence(again = false) {
		const connection = this.connection;
		if (!connection || !this.presence) return;
		const body = JSON.stringify({ connection, ...this.presence } satisfies PresenceUpdate);
		if (body === this.posted && !again) return;
		this.posted = body;
		try {
			const response = await this.api.fetch('/presence', {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body
			});
			if (!response.ok && this.posted === body) this.posted = '';
		} catch {
			// The next change, or the next connection, sends it again.
			if (this.posted === body) this.posted = '';
		}
	}

	private async request<T = Result>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await this.api.fetch(path, {
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(result.error ?? 'Something went wrong. Try again.');
		}
		return result as T;
	}

	private apply(result: Result) {
		if (result.thread) {
			const thread = result.thread;
			const index = this.threads.findIndex((t) => t.id === thread.id);
			if (index === -1) this.threads.push(thread);
			else this.threads[index] = thread;
		}
		if (result.deleted !== undefined) this.threads = this.threads.filter((t) => t.id !== result.deleted);
	}

	/** Runs an action, showing its error and resyncing with the server if it fails. */
	private async run(action: () => Promise<Result>, rethrow = false) {
		try {
			this.apply(await action());
		} catch (error) {
			this.error = (error as Error).message;
			void this.refresh();
			if (rethrow) throw error;
		}
	}

	private update(id: number, change: (thread: CommentThread) => CommentThread) {
		const index = this.threads.findIndex((t) => t.id === id);
		if (index !== -1) this.threads[index] = change(this.threads[index]);
	}

	imageUrl(image: CommentImage) {
		return `${this.api.endpoint}/images/${image.id}/${image.key}`;
	}

	/** Uploads an image for a comment being written. Send its id with the comment. */
	async upload(file: Blob, width: number, height: number): Promise<CommentImage> {
		const response = await this.api.fetch(`/images?width=${width}&height=${height}`, {
			method: 'POST',
			headers: { 'Content-Type': file.type },
			body: file
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(result.error ?? (response.status === 413 ? 'This image is too large.' : 'The image could not be uploaded.'));
		}
		return result.image as CommentImage;
	}

	async create(input: Omit<NewThreadInput, 'images'>, images: CommentImage[] = []): Promise<CommentThread> {
		const { thread } = await this.request('POST', '/threads', { ...input, images: images.map((i) => i.id) });
		this.apply({ thread });
		return thread!;
	}

	/** Shows the reply at once; throws if it could not be sent. */
	async reply(threadId: number, body: string, images: CommentImage[] = []) {
		const pending: Comment = {
			id: this.nextPending--, author: this.viewer!, body, images, createdAt: Date.now(), editedAt: null, pending: true
		};
		this.update(threadId, (t) => ({ ...t, resolvedAt: null, resolvedBy: null, comments: [...t.comments, pending] }));
		try {
			await this.run(() => this.request('POST', `/threads/${threadId}/comments`, { body, images: images.map((i) => i.id) }), true);
		} finally {
			this.update(threadId, (t) => ({ ...t, comments: t.comments.filter((c) => c.id !== pending.id) }));
		}
	}

	async edit(commentId: number, body: string, images: CommentImage[]) {
		await this.run(() => this.request('PATCH', `/comments/${commentId}`, { body, images: images.map((i) => i.id) }), true);
	}

	async removeComment(commentId: number) {
		await this.run(() => this.request('DELETE', `/comments/${commentId}`));
	}

	async removeThread(threadId: number) {
		this.threads = this.threads.filter((t) => t.id !== threadId);
		await this.run(() => this.request('DELETE', `/threads/${threadId}`));
	}

	async resolve(threadId: number, resolved: boolean) {
		this.update(threadId, (t) => ({
			...t, resolvedAt: resolved ? Date.now() : null, resolvedBy: resolved ? this.viewer : null
		}));
		await this.run(() => this.request('PATCH', `/threads/${threadId}`, { resolved }));
	}

	async markRead(threadId: number, read: boolean) {
		this.update(threadId, (t) => ({ ...t, unread: !read && t.comments.some((c) => c.author.sub !== this.viewer?.sub) }));
		await this.run(() => this.request('POST', `/threads/${threadId}/read`, { read }));
	}

	async markAllRead() {
		await Promise.all(this.threads.filter((t) => t.unread).map((t) => this.markRead(t.id, true)));
	}

	// Agents.

	async loadAgents() {
		try {
			this.agents = (await this.request<{ agents: Agent[] }>('GET', '/agents')).agents;
		} catch {
			this.agents = undefined;
		}
	}

	/** Takes an agent out of the space at once: its token stops working. */
	async removeAgent(id: string) {
		this.agents = this.agents?.filter((agent) => agent.id !== id);
		try {
			await this.request('DELETE', `/agents/${encodeURIComponent(id)}`);
		} catch (error) {
			this.error = (error as Error).message;
			void this.loadAgents();
		}
	}

	/** An agent asking to join, for the person approving it. Throws when it has expired or was answered. */
	async agentRequest(id: string): Promise<AgentRequest> {
		return (await this.request<{ request: AgentRequest }>('GET', `/agents/requests/${encodeURIComponent(id)}`)).request;
	}

	async approveAgent(id: string): Promise<Agent> {
		const { agent } = await this.request<{ agent: Agent }>('POST', `/agents/requests/${encodeURIComponent(id)}/approve`);
		if (this.agents) this.agents = [...this.agents.filter((a) => a.id !== agent.id), agent];
		return agent;
	}

	async denyAgent(id: string) {
		await this.request('DELETE', `/agents/requests/${encodeURIComponent(id)}`);
	}
}
