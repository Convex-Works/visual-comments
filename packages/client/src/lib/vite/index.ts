// A Vite plugin that leaves the comments out of a build altogether: for builds
// that must not carry a review tool, such as production's, whatever the
// variables say when they run. The site's code stays as it is: `<Comments>`
// of `visual-comments/sveltekit` renders only what it wraps, `<Toolbar>` only
// the app's own tools (or nothing), and `commentsFromEnv` of
// `visual-comments/server` is always off, so the comments' client, the proxy
// and their sign-in are not in the build. The variables are still declared,
// so the same `src/env.ts` serves both.

import type { Plugin } from 'vite';

export interface VisualCommentsPluginOptions {
	/**
	 * Whether the comments are in the build. Default: under the dev server, and
	 * in a build only with `VISUAL_COMMENTS_BUILD=true` in its environment.
	 */
	include?: boolean;
}

/** This package's `dist/`, as Vite writes module ids. */
const dist = (() => {
	const path = decodeURIComponent(new URL('../', import.meta.url).pathname);
	return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
})();

const COMMENTS = `<script>
	// Left out of this build (visual-comments/vite): renders what it wraps.
	let { comments = $bindable(), children } = $props();
</script>

{@render children?.()}
`;

const COMMENT_TOOLS = `<script>
	// Left out of this build (visual-comments/vite).
	let { divider } = $props();
</script>
`;

const ENV = `// Left out of this build (visual-comments/vite): comments are off, whatever the variables say.
export { commentsVariables } from './variables.js';

let warned = false;

export function commentsFromEnv(env) {
	if (!warned && env?.VISUAL_COMMENTS_ENABLED === 'true') {
		warned = true;
		console.warn('[visual-comments] VISUAL_COMMENTS_ENABLED is true, but this build leaves the comments out (visual-comments/vite).');
	}
	return {
		enabled: false,
		client: null,
		load: async () => null,
		handle: async () => undefined,
		sveltekit: () => ({ event, resolve }) => Promise.resolve(resolve(event))
	};
}
`;

const STUBS: Record<string, string> = {
	[`${dist}sveltekit/Comments.svelte`]: COMMENTS,
	[`${dist}sveltekit/CommentTools.svelte`]: COMMENT_TOOLS,
	[`${dist}server/env.js`]: ENV
};

function environment(name: string): string | undefined {
	return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

/**
 * Puts the comments in development and in the builds that ask for them, and
 * leaves them out of every other build:
 *
 * ```ts
 * // vite.config.ts
 * import { visualComments } from 'visual-comments/vite';
 *
 * export default defineConfig({ plugins: [visualComments(), sveltekit()] });
 * ```
 */
export function visualComments(options: VisualCommentsPluginOptions = {}): Plugin {
	let include = true;
	return {
		name: 'visual-comments',
		enforce: 'pre',
		config(_, { command }) {
			include = options.include ?? (command === 'serve' || environment('VISUAL_COMMENTS_BUILD') === 'true');
			// Bundled into the server too, where it would otherwise be loaded from node_modules as it is.
			return include ? undefined : { ssr: { noExternal: ['visual-comments'] } };
		},
		load(id) {
			return include ? undefined : STUBS[id];
		}
	};
}
