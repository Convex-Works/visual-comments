import type { Session } from './session.js';
import type {
	Comment, CommentImage, CommentThread, CommentsSnapshot, NewThreadInput, Viewer
} from '../shared/types.js';

type Result = { thread?: CommentThread; deleted?: number };

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

	private session: Session;
	private refreshing?: Promise<void>;
	private queued = false;
	private listening?: AbortController;
	private nextPending = -1;

	constructor(session: Session) {
		this.session = session;
	}

	get unreadCount(): number {
		return this.threads.filter((thread) => thread.unread && !thread.resolvedAt).length;
	}

	start() {
		const takeError = () => {
			if (this.session.error) this.error = this.session.error;
			this.session.error = null;
		};
		takeError();
		void this.refresh();
		const onfocus = () => { void this.refresh(); };
		window.addEventListener('focus', onfocus);
		const timer = setInterval(() => { this.now = Date.now(); }, 30_000);
		const stop = this.session.onChange(() => {
			takeError();
			this.stopListening();
			void this.refresh();
		});
		return () => {
			window.removeEventListener('focus', onfocus);
			clearInterval(timer);
			stop();
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
				const response = await this.session.fetch('');
				if (!response.ok) throw new Error();
				const snapshot = (await response.json()) as CommentsSnapshot;
				this.session.expired(snapshot.viewer);
				this.viewer = snapshot.viewer;
				this.spaceName = snapshot.space.name;
				// Keep replies that are still on their way to the server.
				const pending = new Map(this.threads.map((t) => [t.id, t.comments.filter((c) => c.pending)]));
				this.threads = snapshot.threads.map((thread) => {
					const waiting = pending.get(thread.id);
					return waiting?.length ? { ...thread, comments: [...thread.comments, ...waiting] } : thread;
				});
				if (this.viewer) this.listen();
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
	}

	/** Follows the event stream; after a dropped connection, catches up on anything missed. */
	private listen() {
		if (this.listening) return;
		const controller = new AbortController();
		this.listening = controller;
		void (async () => {
			let connected = false;
			while (!controller.signal.aborted && this.session.token) {
				try {
					const response = await this.session.fetch('/events', { signal: controller.signal });
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
							if (/^event: change$/m.test(buffer.slice(0, end))) void this.refresh();
							buffer = buffer.slice(end + 2);
						}
					}
				} catch {
					// Dropped; try again shortly.
				}
				if (controller.signal.aborted) break;
				await new Promise((done) => setTimeout(done, 3000));
			}
			if (this.listening === controller) this.listening = undefined;
		})();
	}

	private async request(method: string, path: string, body?: unknown): Promise<Result> {
		const response = await this.session.fetch(path, {
			method,
			headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const result = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(result.error ?? 'Something went wrong. Try again.');
		}
		return result as Result;
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
		return `${this.session.server}/v1/images/${image.id}/${image.key}`;
	}

	/** Uploads an image for a comment being written. Send its id with the comment. */
	async upload(file: Blob, width: number, height: number): Promise<CommentImage> {
		const response = await this.session.fetch(`/images?width=${width}&height=${height}`, {
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
}
