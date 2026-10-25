import { getContext, setContext } from 'svelte';
import type { Viewer } from '../shared/types.js';
import type { VisualComments } from '../visual-comments.svelte.js';

/** The comments of the app, as `<Comments>` provides them. Both fields are reactive. */
export interface AppComments {
	/** Whether comments are on for this deployment: `<Comments config>` is set. */
	readonly enabled: boolean;
	/** The comments, once they have started in the browser; undefined before, during server rendering, and while off. */
	readonly current: VisualComments | undefined;
	/** Who is signed in as the page loaded (`comments.load` on the server); undefined when it did not say. */
	readonly viewer: Viewer | null | undefined;
	/** Where the sign-in routes are, e.g. `/auth`. */
	readonly auth: string;
}

const KEY = Symbol('visual-comments/sveltekit');

export function setAppComments(comments: AppComments) {
	setContext(KEY, comments);
}

/** The comments of the app, inside `<Comments>`; undefined outside it. */
export function useComments(): AppComments | undefined {
	return getContext<AppComments | undefined>(KEY);
}
