// Shapes shared by the browser client and the server.

/** Who wrote a comment. From the site's sign-in, saved by the server. */
export interface Author {
	sub: string;
	name: string;
	picture?: string;
}

/** The person signed in on the site. */
export interface Viewer extends Author {
	email?: string;
}

/** An image in a comment, served at `<endpoint>/images/<id>/<key>`. */
export interface CommentImage {
	id: number;
	/** Part of its address, so addresses cannot be guessed from ids. */
	key: string;
	/** Its size in pixels, so it can be laid out before it loads. */
	width: number;
	height: number;
}

export interface Comment {
	id: number;
	author: Author;
	/** Empty when the comment is only images. */
	body: string;
	images: CommentImage[];
	/** Milliseconds since the epoch. */
	createdAt: number;
	editedAt: number | null;
	/** Sent but not yet confirmed by the server. */
	pending?: boolean;
}

/** The element a pin was placed on, as it was then. */
export interface CommentAnchor {
	/** A CSS selector for it in its document. */
	selector: string;
	/** What it is and what it says, e.g. `button “Add prompts”`. */
	label: string;
	/** Its visible text, shortened. */
	text: string;
	/** Its box in the surface's CSS pixels. */
	x: number;
	y: number;
	width: number;
	height: number;
}

/** A pin and the conversation under it. The first comment opens the thread. */
export interface CommentThread {
	/** Its number in the space, shown as #id. Never reused. */
	id: number;
	/** The page it is on: by default the URL's origin and path. */
	page: string;
	/** The address it was placed at. */
	url: string;
	/** The surface on the page, or '' for the page itself. */
	surface: string;
	/** The surface's title, or the page's, when the thread was placed. */
	title: string;
	/** Pin position in the surface's CSS pixels, from its top-left corner. */
	x: number;
	y: number;
	/** Null for a pin in open space. */
	anchor: CommentAnchor | null;
	/** What the host said about where the thread was placed, e.g. the viewport size. */
	context: Record<string, string>;
	createdAt: number;
	resolvedAt: number | null;
	resolvedBy: Author | null;
	/** Someone else has written in the thread since the viewer last opened it. */
	unread: boolean;
	comments: Comment[];
}

export interface CommentsSnapshot {
	space: { id: string; name: string };
	/** Null when signed out. */
	viewer: Viewer | null;
	threads: CommentThread[];
}

/** What a client sends to start a thread. */
export interface NewThreadInput {
	page: string;
	url: string;
	surface: string;
	title: string;
	x: number;
	y: number;
	anchor?: CommentAnchor | null;
	context?: Record<string, string>;
	body: string;
	images?: number[];
}
