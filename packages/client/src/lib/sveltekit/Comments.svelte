<!--
  Adds comments to a SvelteKit app. Put it in the root layout, around the
  pages, with the config the server's `commentsFromEnv` gives the layout's
  `load`. With no config, comments are off: it renders only the pages, and the
  browser never loads the comments' code.
-->
<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { CommentsClientConfig } from '../server/env.js';
	import type { VisualComments, VisualCommentsOptions } from '../visual-comments.svelte.js';

	export interface CommentsProps extends Omit<VisualCommentsOptions, 'endpoint' | 'auth' | 'page'> {
		/** Where the comments and sign-in are, from `commentsFromEnv(...).client`. Null or undefined: comments are off. */
		config: CommentsClientConfig | null | undefined;
		/**
		 * Which threads a page shows. `path` (default): each address's own, by
		 * origin and path. `route`: every address of a route shares them, so
		 * `/projects/1` and `/projects/2` show the threads of `/projects/[id]`.
		 * A string: one set for every page. A function: a key for each address.
		 */
		page?: 'path' | 'route' | (string & {}) | ((url: URL) => string);
		/** Signs in and out another way than the sign-in routes of `config.auth`. */
		auth?: { signIn(): void; signOut(): void };
		/** The comments while they run, to bind to. */
		comments?: VisualComments;
		children?: Snippet;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { page as current } from '$app/state';
	import { setAppComments } from './context.js';

	let { config, page = 'path', auth, comments = $bindable(), children, ...rest }: CommentsProps = $props();

	// Started again only when where the comments are changes, not whenever `load` runs again.
	const endpoint = $derived(config?.endpoint);
	const authPath = $derived(config?.auth);

	setAppComments({
		get enabled() { return Boolean(endpoint); },
		get current() { return comments; },
		get viewer() { return config?.viewer; },
		get auth() { return authPath ?? '/auth'; }
	});

	/** The page key of an address: its origin and path, without a trailing slash. */
	function pathKey(url: URL) {
		const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
		return `${url.origin}${path}`;
	}

	function pageOption(option: NonNullable<CommentsProps['page']>): VisualCommentsOptions['page'] {
		if (option === 'path') return undefined;
		// Read when the comments measure the page, by when the router has updated `page`.
		if (option === 'route') return (url) => (current.route.id ? `${url.origin}${current.route.id}` : pathKey(url));
		return option;
	}

	/** Goes to a thread on another page of the app with the router, so the comments stay open. */
	function navigate(link: string) {
		const url = new URL(link, location.href);
		if (url.origin !== location.origin) return location.assign(link);
		// The thread is already open; its link's `#vc=<id>` is only for addresses opened anew.
		const hash = url.hash.slice(1).split('&').filter((part) => part && !part.startsWith('vc=')).join('&');
		void goto(`${url.pathname}${url.search}${hash ? `#${hash}` : ''}`).then(() => comments?.relayout());
	}

	const options = $derived<VisualCommentsOptions>({
		navigate,
		...rest,
		page: pageOption(page),
		...(auth ? { auth } : {})
	});

	$effect(() => {
		if (!endpoint) return;
		const start = { endpoint, auth: authPath ?? '/auth' };
		let stopped = false;
		let instance: VisualComments | undefined;
		// Loaded only when comments are on, so an app without them never downloads their code.
		void import('../index.js').then(({ createVisualComments }) => {
			if (stopped) return;
			// Who the page was loaded for, so the account shows without waiting for the server.
			instance = createVisualComments({ ...untrack(() => options), ...start, viewer: untrack(() => config?.viewer) });
			comments = instance;
		});
		return () => {
			stopped = true;
			instance?.destroy();
			if (untrack(() => comments) === instance) comments = undefined;
		};
	});

	// Options the app changes later, e.g. a `show` that depends on its state.
	$effect(() => {
		const next = options;
		untrack(() => comments)?.configure(next);
	});
</script>

{@render children?.()}
