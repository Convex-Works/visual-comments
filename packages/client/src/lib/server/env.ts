// Comments set up from environment variables, so each deployment turns them on
// or off without a new build: on in development and staging, say, and absent
// in production. Off, the site answers no comment requests and the browser
// never loads the comments' code. (To leave them out of a build altogether, see
// `visual-comments/vite`.)

import type * as SignInModule from '@cnvx/sign-in/server';
import type { Viewer } from '../shared/types.js';
import { commentsProxy, type CommentsUser, type Handle } from './index.js';
import { invalid, read, type CommentsEnv, type CommentsEnvName } from './variables.js';

export { commentsVariables, type CommentsEnv, type CommentsEnvName } from './variables.js';

export interface CommentsSignInOptions {
	/**
	 * More host names the development sign-in works on, besides localhost: e.g.
	 * the machine's address on a private network, to open the dev server from
	 * another machine. Whoever reaches the site there can sign in as anyone.
	 */
	devHosts?: string[];
}

export interface CommentsEnvOptions {
	/**
	 * Whether the dev server is running: `dev` from `$app/env` (`$app/environment`
	 * before SvelteKit 3). Needed for `VISUAL_COMMENTS_ENABLED=dev`, and for the
	 * development sign-in.
	 */
	dev?: boolean;
	/**
	 * Sign people in to the comments apart from the site's own accounts, with
	 * `@cnvx/sign-in` (install it beside this package): at the provider of
	 * the `VISUAL_COMMENTS_OIDC_*` variables, or, while the dev server runs without
	 * them, with any name on localhost. Its routes are at `VISUAL_COMMENTS_AUTH`;
	 * its session is the `visual_comments_session` cookie. Without it, the site's
	 * own sign-in says who comments (`sveltekit(user)`).
	 */
	signIn?: boolean | CommentsSignInOptions;
}

/** What the browser needs to reach the comments, for `<Comments config>` of `visual-comments/sveltekit`. */
export interface CommentsClientConfig {
	/** Where this site answers comment requests, e.g. `/_comments`. */
	endpoint: string;
	/** Where this site's sign-in routes are, e.g. `/auth`. */
	auth: string;
	/**
	 * Who is signed in to the comments, as the server knows it when the page
	 * loads (`load`): null for nobody, so the toolbar shows them at once.
	 * Undefined: the browser asks.
	 */
	viewer?: Viewer | null;
}

export interface CommentsFromEnv {
	/** Whether comments are on. */
	readonly enabled: boolean;
	/** For the browser, e.g. returned by the root layout's `load`. Null while comments are off. */
	readonly client: CommentsClientConfig | null;
	/**
	 * `client` with who is signed in to the comments' own sign-in, for the root
	 * layout's `load`: `load: (event) => comments.load(event)`. Without the own
	 * sign-in, or while off, it is `client`.
	 */
	load(event: { request: Request }): Promise<CommentsClientConfig | null>;
	/** Answers comment requests as `user`; undefined for any other request, and for every request while off. */
	handle(request: Request, user: CommentsUser): Promise<Response | undefined>;
	/**
	 * SvelteKit's `handle` hook. With the comments' own sign-in, it answers its
	 * routes and comments as the person signed in there; put it first. Otherwise
	 * put it after the site's sign-in: by default the person is
	 * `event.locals.user`. While off it passes every request on.
	 */
	sveltekit<E extends { request: Request; locals: object }>(user?: (event: E) => CommentsUser | Promise<CommentsUser>): Handle<E>;
}

/** The comments' own sign-in's cookie. */
const COOKIE = 'visual_comments_session';
const OIDC: CommentsEnvName[] = ['VISUAL_COMMENTS_OIDC_ISSUER', 'VISUAL_COMMENTS_OIDC_CLIENT_ID', 'VISUAL_COMMENTS_OIDC_CLIENT_SECRET'];

/**
 * Sets up comments from `VISUAL_COMMENTS_*` variables. They are off unless
 * `VISUAL_COMMENTS_ENABLED` is `true`, or `dev` while the dev server runs;
 * on, `VISUAL_COMMENTS_SERVER`, `VISUAL_COMMENTS_SPACE` and
 * `VISUAL_COMMENTS_SECRET` must be set, and with `signIn` outside the dev
 * server the `VISUAL_COMMENTS_OIDC_*` ones and `VISUAL_COMMENTS_SESSION_SECRET`.
 * Throws on a missing or invalid value, so a deployment fails at start rather
 * than when someone comments.
 */
export function commentsFromEnv(env: CommentsEnv, options: CommentsEnvOptions = {}): CommentsFromEnv {
	const flag = read(env, 'VISUAL_COMMENTS_ENABLED') ?? 'false';
	if (flag === 'dev' && options.dev === undefined) {
		throw invalid('VISUAL_COMMENTS_ENABLED', 'is dev, so commentsFromEnv needs { dev }: `dev` from $app/env');
	}
	const enabled = flag === 'true' || (flag === 'dev' && options.dev === true);
	if (!enabled) {
		return {
			enabled: false,
			client: null,
			load: async () => null,
			handle: async () => undefined,
			sveltekit: () => ({ event, resolve }) => Promise.resolve(resolve(event))
		};
	}

	const required = (name: CommentsEnvName) => read(env, name) ?? (() => { throw invalid(name, 'must be set while comments are on'); })();
	const path = (read(env, 'VISUAL_COMMENTS_PATH') ?? '/_comments').replace(/(.)\/+$/, '$1');
	const auth = (read(env, 'VISUAL_COMMENTS_AUTH') ?? '/auth').replace(/(.)\/+$/, '$1');
	const proxy = commentsProxy({
		server: required('VISUAL_COMMENTS_SERVER'),
		space: required('VISUAL_COMMENTS_SPACE'),
		secret: required('VISUAL_COMMENTS_SECRET'),
		path
	});
	const client = { endpoint: path, auth };
	if (!options.signIn) return { enabled: true, client, load: async () => client, handle: proxy.handle, sveltekit: proxy.sveltekit };

	// The comments' own sign-in: at the provider, or in development with any name.
	const provider = OIDC.some((name) => read(env, name)) || !options.dev;
	const [issuer, clientId, clientSecret] = OIDC.map((name) => (provider ? required(name) : undefined));
	// In development the space's secret makes the key when there is no session secret, so the
	// sessions outlast restarts of the dev server.
	const secret = provider
		? required('VISUAL_COMMENTS_SESSION_SECRET')
		: read(env, 'VISUAL_COMMENTS_SESSION_SECRET') ?? `visual-comments dev sign-in:${required('VISUAL_COMMENTS_SECRET')}`;
	const devHosts = typeof options.signIn === 'object' ? options.signIn.devHosts : undefined;
	let module: Promise<{ signIn: SignInModule.SignIn; withCookies: typeof SignInModule.withCookies }> | undefined;
	// Loaded on the first request, so sites without it can use the rest of this module.
	const load = () => (module ??= import('@cnvx/sign-in/server').then(
		({ createSignIn, withCookies }) => ({
			signIn: createSignIn({ issuer, clientId, clientSecret, secret, path: auth, cookie: COOKIE, devLogin: !provider, devHosts }),
			withCookies
		}),
		(error) => { throw new Error('The comments’ own sign-in needs @cnvx/sign-in: install it beside visual-comments.', { cause: error }); }
	));

	// One check per request: the layout's `load` and the hook share it, and the hook sets the
	// cookies it renews.
	const sessions = new WeakMap<Request, Promise<SignInModule.SessionCheck>>();
	const check = (request: Request) => {
		let session = sessions.get(request);
		if (!session) sessions.set(request, (session = load().then(({ signIn }) => signIn.check(request))));
		return session;
	};

	return {
		enabled: true,
		client,
		load: async ({ request }) => ({ ...client, viewer: (await check(request)).user ?? null }),
		handle: proxy.handle,
		sveltekit: () => async ({ event, resolve }) => {
			const { signIn, withCookies } = await load();
			const answered = await signIn.handle(event.request);
			if (answered) return answered;
			const { pathname } = new URL(event.request.url);
			if (pathname === path || pathname.startsWith(`${path}/`)) {
				const session = await check(event.request);
				const response = await proxy.handle(event.request, session.user);
				if (response) return withCookies(response, session.cookies);
			}
			const response = await resolve(event);
			const session = sessions.get(event.request);
			return session ? withCookies(response, (await session).cookies) : response;
		}
	};
}
