// Shapes shared by the browser client and the server.

/** Who wrote a comment. From the site's sign-in, saved by the server. */
export interface Author {
	sub: string;
	name: string;
	picture?: string;
	/** Set when the author is an agent: it joined the space when a person approved it. */
	agent?: { addedBy: { sub: string; name: string } };
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

/** What someone present is doing. */
export type PresenceState = 'viewing' | 'typing' | 'working';

/** Someone in the space right now: one per browser tab, or one per task of an agent. */
export interface Participant {
	/** Stable while they stay. */
	id: string;
	author: Author;
	state: PresenceState;
	page?: string;
	surface?: string;
	thread?: number;
	/** What they are doing, in their words, e.g. `Tightening the table`. */
	note?: string;
	/** When the state last changed, in milliseconds since the epoch. */
	since: number;
}

/** What a client sends to `POST /presence`. */
export interface PresenceUpdate {
	/** A browser's connection, from the event stream's `hello` event. Agents leave it out. */
	connection?: string;
	/** Agents only: one participant per key, so one agent can work on several things at once. Default `''`. */
	key?: string;
	/** `gone` removes the participant. */
	state: PresenceState | 'gone';
	page?: string;
	surface?: string;
	thread?: number;
	note?: string;
}

/** An agent of the space. */
export interface Agent {
	id: string;
	name: string;
	addedBy: { sub: string; name: string };
	createdAt: number;
	lastSeenAt: number | null;
}

/** An agent asking to join the space, waiting for a person to approve it. */
export interface AgentRequest {
	id: string;
	name: string;
	/** Shown to the agent and to the person approving, so both know it is the same request. */
	code: string;
	expiresAt: number;
}

/** The request as the agent that asked gets it: with the secret it collects its token with. */
export interface NewAgentRequest extends AgentRequest {
	secret: string;
}

/** What `GET /agent/next` answers: the threads with something new for the agent. */
export interface AgentInbox {
	threads: CommentThread[];
	participants: Participant[];
}
