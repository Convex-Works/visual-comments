import { randomBytes } from 'node:crypto';
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
	Author, Comment, CommentAnchor, CommentImage, CommentThread, Viewer
} from '../../client/src/lib/shared/types.ts';

/** A request the store refused, with the HTTP status the handler should send. */
export class CommentError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export interface NewThread {
	page: string;
	url: string;
	surface: string;
	title: string;
	x: number;
	y: number;
	anchor: CommentAnchor | null;
	context: Record<string, string>;
	body: string;
	images: number[];
}

export interface NewImage {
	type: string;
	width: number;
	height: number;
	data: Uint8Array;
}

/** Images uploaded but never sent with a comment are dropped after this long. */
const UNSENT_IMAGE_MS = 24 * 60 * 60 * 1000;

type Row = Record<string, string | number | null>;

// Each entry moves the database up one version (PRAGMA user_version).
const MIGRATIONS: string[][] = [
	[
		// People as each space's site last described them. Sites only change their own space's people.
		`CREATE TABLE users (
			space TEXT NOT NULL,
			sub TEXT NOT NULL,
			name TEXT NOT NULL,
			email TEXT,
			picture TEXT,
			seen_at INTEGER NOT NULL,
			PRIMARY KEY (space, sub)
		) WITHOUT ROWID`,
		// The last thread number given out in each space, so numbers are never reused.
		`CREATE TABLE counters (
			space TEXT PRIMARY KEY,
			threads INTEGER NOT NULL
		) WITHOUT ROWID`,
		`CREATE TABLE threads (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			space TEXT NOT NULL,
			number INTEGER NOT NULL,
			page TEXT NOT NULL,
			url TEXT NOT NULL,
			surface TEXT NOT NULL,
			title TEXT NOT NULL,
			x REAL NOT NULL,
			y REAL NOT NULL,
			-- The element under the pin, and what the host said about the place, as JSON.
			anchor TEXT,
			context TEXT NOT NULL DEFAULT '{}',
			author TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			resolved_at INTEGER,
			resolved_by TEXT,
			UNIQUE (space, number)
		)`,
		`CREATE TABLE comments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			thread INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
			author TEXT NOT NULL,
			body TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			edited_at INTEGER
		)`,
		`CREATE INDEX comments_by_thread ON comments(thread, id)`,
		// The newest comment each person has seen in a thread.
		`CREATE TABLE reads (
			thread INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
			user TEXT NOT NULL,
			comment INTEGER NOT NULL,
			PRIMARY KEY (thread, user)
		) WITHOUT ROWID`,
		// Images upload while the comment is written, so `comment` starts empty.
		`CREATE TABLE images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			key TEXT NOT NULL,
			space TEXT NOT NULL,
			comment INTEGER REFERENCES comments(id) ON DELETE CASCADE,
			author TEXT NOT NULL,
			type TEXT NOT NULL,
			width INTEGER NOT NULL,
			height INTEGER NOT NULL,
			data BLOB NOT NULL,
			created_at INTEGER NOT NULL
		)`,
		`CREATE INDEX images_by_comment ON images(comment, id)`
	]
];

/** Comment threads of every space in one SQLite file. Synchronous: each call is atomic in a Node process. */
export class CommentStore {
	/** Dispatches `change` with the space as its detail after every write. */
	readonly events = new EventTarget();
	private db: DatabaseSync;
	private filename: string;
	/** The file this store opened, to notice when it is deleted or replaced. */
	private identity?: { dev: number; ino: number };

	constructor(filename: string) {
		this.filename = filename;
		if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
		this.db = new DatabaseSync(filename);
		if (filename !== ':memory:') {
			const { dev, ino } = statSync(filename);
			this.identity = { dev, ino };
		}
		this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
		const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
		if (version < MIGRATIONS.length) this.transaction(() => {
			for (const statements of MIGRATIONS.slice(version)) for (const statement of statements) this.db.exec(statement);
			this.db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
		});
	}

	/** Closing checkpoints the WAL, so every comment ends up in the one database file. */
	close() {
		if (this.db.isOpen) this.db.close();
	}

	/**
	 * SQLite keeps reading and writing a database file that was deleted or
	 * replaced while open, and those writes are lost. Refuse instead.
	 */
	private ensureSameFile() {
		if (!this.identity) return;
		let now: { dev: number; ino: number } | undefined;
		try {
			now = statSync(this.filename);
		} catch {
			// Deleted.
		}
		if (now?.dev !== this.identity.dev || now?.ino !== this.identity.ino) {
			throw new CommentError(
				503,
				`The comment database ${this.filename} was deleted or replaced while the server was running. Restart the server.`
			);
		}
	}

	transaction<T>(run: () => T): T {
		this.ensureSameFile();
		this.db.exec('BEGIN IMMEDIATE');
		try {
			const result = run();
			this.db.exec('COMMIT');
			return result;
		} catch (error) {
			this.db.exec('ROLLBACK');
			throw error;
		}
	}

	/** For scripts that move data in, such as the paraframe import. */
	get database(): DatabaseSync {
		return this.db;
	}

	private changed(space: string) {
		this.events.dispatchEvent(new CustomEvent('change', { detail: space }));
	}

	saveUser(space: string, user: Viewer, now = Date.now()) {
		this.db.prepare(`INSERT INTO users (space, sub, name, email, picture, seen_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT (space, sub) DO UPDATE SET name = excluded.name, email = coalesce(excluded.email, users.email),
			picture = excluded.picture, seen_at = excluded.seen_at`)
			.run(space, user.sub, user.name, user.email ?? null, user.picture ?? null, now);
	}

	// Comments.

	private markReadUpTo(thread: number, user: string, comment: number) {
		this.db.prepare(`INSERT INTO reads (thread, user, comment) VALUES (?, ?, ?)
			ON CONFLICT (thread, user) DO UPDATE SET comment = max(comment, excluded.comment)`)
			.run(thread, user, comment);
	}

	private addComment(thread: number, space: string, user: string, body: string, images: number[], now: number) {
		const { lastInsertRowid } = this.db.prepare(
			'INSERT INTO comments (thread, author, body, created_at) VALUES (?, ?, ?, ?)'
		).run(thread, user, body, now);
		const id = Number(lastInsertRowid);
		this.setImages(id, space, user, images);
		this.markReadUpTo(thread, user, id);
	}

	/** Makes `ids` the comment's images: drops the ones left out, attaches the viewer's new uploads. */
	private setImages(comment: number, space: string, user: string, ids: number[]) {
		this.db.prepare('DELETE FROM images WHERE comment = ? AND id NOT IN (SELECT value FROM json_each(?))')
			.run(comment, JSON.stringify(ids));
		const attach = this.db.prepare(
			'UPDATE images SET comment = ? WHERE id = ? AND author = ? AND space = ? AND (comment IS NULL OR comment = ?)'
		);
		for (const id of ids) {
			if (!attach.run(comment, id, user, space, comment).changes) {
				throw new CommentError(400, 'An image could not be attached. Add it again.');
			}
		}
	}

	/** Stores an image before its comment is sent. */
	addImage(space: string, user: Viewer, image: NewImage): CommentImage {
		const now = Date.now();
		const key = randomBytes(16).toString('base64url');
		const id = this.transaction(() => {
			this.saveUser(space, user, now);
			this.db.prepare('DELETE FROM images WHERE comment IS NULL AND created_at < ?').run(now - UNSENT_IMAGE_MS);
			const { lastInsertRowid } = this.db.prepare(
				'INSERT INTO images (key, space, author, type, width, height, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
			).run(key, space, user.sub, image.type, image.width, image.height, image.data, now);
			return Number(lastInsertRowid);
		});
		return { id, key, width: image.width, height: image.height };
	}

	/** An image of the space by its address. */
	image(space: string, id: number, key: string): { type: string; data: Uint8Array } {
		this.ensureSameFile();
		const row = this.db.prepare('SELECT type, data, key FROM images WHERE id = ? AND space = ?').get(id, space) as
			| { type: string; data: Uint8Array; key: string }
			| undefined;
		if (!row || row.key !== key) throw new CommentError(404, 'This image no longer exists.');
		return { type: row.type, data: row.data };
	}

	/** Every thread in the space with its comments, oldest first, as seen by the viewer. */
	list(space: string, viewer: string | null): CommentThread[] {
		return this.load(space, viewer);
	}

	thread(space: string, number: number, viewer: string | null): CommentThread {
		const thread = this.load(space, viewer, number)[0];
		if (!thread) throw new CommentError(404, 'This comment no longer exists.');
		return thread;
	}

	private load(space: string, viewer: string | null, only?: number): CommentThread[] {
		this.ensureSameFile();
		const where = only === undefined ? '' : 'AND t.number = ?';
		const params: (string | number)[] = only === undefined ? [space] : [space, only];
		const users = new Map<string, Author>();
		const userRows = this.db.prepare(`SELECT sub, name, picture FROM users WHERE space = ? AND sub IN (
			SELECT c.author FROM comments c JOIN threads t ON t.id = c.thread WHERE t.space = ?
			UNION SELECT resolved_by FROM threads WHERE space = ?)`).all(space, space, space) as Row[];
		for (const row of userRows) {
			users.set(row.sub as string, {
				sub: row.sub as string,
				name: row.name as string,
				...(row.picture ? { picture: row.picture as string } : {})
			});
		}
		const author = (sub: string) => users.get(sub) ?? { sub, name: 'Unknown' };

		const threads = new Map<number, CommentThread & { readUpTo: number }>();
		const threadRows = this.db.prepare(`SELECT t.*, r.comment AS read_up_to FROM threads t
			LEFT JOIN reads r ON r.thread = t.id AND r.user = ? WHERE t.space = ? ${where} ORDER BY t.number`)
			.all(viewer, ...params) as Row[];
		for (const row of threadRows) {
			threads.set(row.id as number, {
				id: row.number as number,
				page: row.page as string,
				url: row.url as string,
				surface: row.surface as string,
				title: row.title as string,
				x: row.x as number,
				y: row.y as number,
				anchor: row.anchor ? JSON.parse(row.anchor as string) as CommentAnchor : null,
				context: JSON.parse(row.context as string) as Record<string, string>,
				createdAt: row.created_at as number,
				resolvedAt: row.resolved_at as number | null,
				resolvedBy: row.resolved_by ? author(row.resolved_by as string) : null,
				unread: false,
				comments: [],
				readUpTo: (row.read_up_to as number | null) ?? 0
			});
		}
		const ids = JSON.stringify([...threads.keys()]);
		const commentRows = this.db.prepare(`SELECT * FROM comments
			WHERE thread IN (SELECT value FROM json_each(?)) ORDER BY id`).all(ids) as Row[];
		const byId = new Map<number, Comment>();
		for (const row of commentRows) {
			const thread = threads.get(row.thread as number)!;
			const comment: Comment = {
				id: row.id as number,
				author: author(row.author as string),
				body: row.body as string,
				images: [],
				createdAt: row.created_at as number,
				editedAt: row.edited_at as number | null
			};
			thread.comments.push(comment);
			byId.set(comment.id, comment);
			if (viewer && comment.author.sub !== viewer && comment.id > thread.readUpTo) thread.unread = true;
		}
		const imageRows = this.db.prepare(`SELECT i.id, i.key, i.comment, i.width, i.height FROM images i
			JOIN comments c ON c.id = i.comment WHERE c.thread IN (SELECT value FROM json_each(?)) ORDER BY i.id`)
			.all(ids) as Row[];
		for (const row of imageRows) {
			byId.get(row.comment as number)?.images.push({
				id: row.id as number, key: row.key as string, width: row.width as number, height: row.height as number
			});
		}
		return [...threads.values()]
			.filter((thread) => thread.comments.length)
			.map(({ readUpTo: _, ...thread }) => thread);
	}

	createThread(space: string, user: Viewer, input: NewThread): CommentThread {
		const now = Date.now();
		const number = this.transaction(() => {
			this.saveUser(space, user, now);
			const { threads } = this.db.prepare(`INSERT INTO counters (space, threads) VALUES (?, 1)
				ON CONFLICT (space) DO UPDATE SET threads = threads + 1 RETURNING threads`).get(space) as { threads: number };
			const { lastInsertRowid } = this.db.prepare(`INSERT INTO threads
				(space, number, page, url, surface, title, x, y, anchor, context, author, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
				space, threads, input.page, input.url, input.surface, input.title, input.x, input.y,
				input.anchor && JSON.stringify(input.anchor), JSON.stringify(input.context), user.sub, now
			);
			this.addComment(Number(lastInsertRowid), space, user.sub, input.body, input.images, now);
			return threads;
		});
		this.changed(space);
		return this.thread(space, number, user.sub);
	}

	reply(space: string, user: Viewer, number: number, body: string, images: number[] = []): CommentThread {
		const now = Date.now();
		this.transaction(() => {
			const { id } = this.requireThread(space, number);
			this.saveUser(space, user, now);
			this.addComment(id, space, user.sub, body, images, now);
			// Replying to a resolved thread reopens it.
			this.db.prepare('UPDATE threads SET resolved_at = NULL, resolved_by = NULL WHERE id = ?').run(id);
		});
		this.changed(space);
		return this.thread(space, number, user.sub);
	}

	/** Leaves the images as they are when `images` is undefined. */
	editComment(space: string, user: Viewer, commentId: number, body: string, images?: number[]): CommentThread {
		const comment = this.requireOwnComment(space, user, commentId);
		this.transaction(() => {
			this.saveUser(space, user, Date.now());
			if (images) this.setImages(commentId, space, user.sub, images);
			const { count } = this.db.prepare('SELECT count(*) AS count FROM images WHERE comment = ?').get(commentId) as { count: number };
			if (!body && !count) throw new CommentError(400, 'A comment needs some text or an image.');
			this.db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, Date.now(), commentId);
		});
		this.changed(space);
		return this.thread(space, comment.number, user.sub);
	}

	/** Deleting a thread's first comment deletes the thread. Returns the thread, or null if deleted. */
	deleteComment(space: string, user: Viewer, commentId: number): CommentThread | null {
		const comment = this.requireOwnComment(space, user, commentId);
		const first = this.db.prepare('SELECT min(id) AS id FROM comments WHERE thread = ?').get(comment.thread) as { id: number };
		if (first.id === commentId) {
			this.db.prepare('DELETE FROM threads WHERE id = ?').run(comment.thread);
			this.changed(space);
			return null;
		}
		this.db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);
		this.changed(space);
		return this.thread(space, comment.number, user.sub);
	}

	deleteThread(space: string, user: Viewer, number: number) {
		const thread = this.requireThread(space, number);
		if (thread.author !== user.sub) throw new CommentError(403, 'Only the person who started a thread can delete it.');
		this.db.prepare('DELETE FROM threads WHERE id = ?').run(thread.id);
		this.changed(space);
	}

	resolve(space: string, user: Viewer, number: number, resolved: boolean): CommentThread {
		this.transaction(() => {
			const { id } = this.requireThread(space, number);
			this.saveUser(space, user, Date.now());
			this.db.prepare('UPDATE threads SET resolved_at = ?, resolved_by = ? WHERE id = ?')
				.run(resolved ? Date.now() : null, resolved ? user.sub : null, id);
		});
		this.changed(space);
		return this.thread(space, number, user.sub);
	}

	/** Read state is per viewer, so it does not notify other viewers. */
	markRead(space: string, user: Viewer, number: number, read: boolean): CommentThread {
		this.transaction(() => {
			const { id } = this.requireThread(space, number);
			this.saveUser(space, user, Date.now());
			if (read) {
				const { last } = this.db.prepare('SELECT max(id) AS last FROM comments WHERE thread = ?').get(id) as { last: number };
				this.markReadUpTo(id, user.sub, last);
			} else this.db.prepare('DELETE FROM reads WHERE thread = ? AND user = ?').run(id, user.sub);
		});
		return this.thread(space, number, user.sub);
	}

	private requireThread(space: string, number: number) {
		this.ensureSameFile();
		const row = this.db.prepare('SELECT id, author FROM threads WHERE space = ? AND number = ?').get(space, number) as
			| { id: number; author: string }
			| undefined;
		if (!row) throw new CommentError(404, 'This comment no longer exists.');
		return row;
	}

	private requireOwnComment(space: string, user: Viewer, id: number) {
		this.ensureSameFile();
		const row = this.db.prepare(`SELECT c.thread, c.author, t.number FROM comments c
			JOIN threads t ON t.id = c.thread WHERE c.id = ? AND t.space = ?`).get(id, space) as
			| { thread: number; author: string; number: number }
			| undefined;
		if (!row) throw new CommentError(404, 'This comment no longer exists.');
		if (row.author !== user.sub) throw new CommentError(403, 'You can only change your own comments.');
		return row;
	}
}
