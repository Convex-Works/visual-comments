// The variables `commentsFromEnv` reads, with their checks. Kept apart from it, so a build
// without the comments (`visual-comments/vite`) still declares them.

/** The variables `commentsFromEnv` reads. */
export type CommentsEnvName =
	| 'VISUAL_COMMENTS_ENABLED'
	| 'VISUAL_COMMENTS_SERVER'
	| 'VISUAL_COMMENTS_SPACE'
	| 'VISUAL_COMMENTS_SECRET'
	| 'VISUAL_COMMENTS_PATH'
	| 'VISUAL_COMMENTS_AUTH'
	| 'VISUAL_COMMENTS_OIDC_ISSUER'
	| 'VISUAL_COMMENTS_OIDC_CLIENT_ID'
	| 'VISUAL_COMMENTS_OIDC_CLIENT_SECRET'
	| 'VISUAL_COMMENTS_SESSION_SECRET';

/**
 * Where the variables come from: `process.env`, SvelteKit's `$app/env/private`
 * (`import * as env from '$app/env/private'`) or `$env/dynamic/private` before
 * SvelteKit 3. Values that are not strings count as unset.
 */
export type CommentsEnv = { readonly [K in CommentsEnvName]?: unknown };

type Check = (value: string) => string | undefined;

const isPath: Check = (value) => (value.startsWith('/') ? undefined : 'must be a path that starts with /, e.g. /_comments');
const isUrl: Check = (value) => (URL.canParse(value) && /^https?:$/.test(new URL(value).protocol) ? undefined : 'must be an http(s) URL');
const isSecret: Check = (value) => (value.length >= 32 ? undefined : 'must be at least 32 characters');

const CHECKS: Record<CommentsEnvName, { description: string; check?: Check }> = {
	VISUAL_COMMENTS_ENABLED: {
		description: 'Whether comments are on: `true`, `false` or `dev` (only while the dev server runs). Default `false`.',
		check: (value) => (['true', 'false', 'dev'].includes(value) ? undefined : 'must be true, false or dev')
	},
	VISUAL_COMMENTS_SERVER: {
		description: 'The comment server, e.g. `https://comments.convex.works`. Required while comments are on.',
		check: isUrl
	},
	VISUAL_COMMENTS_SPACE: {
		description: "The site's space on the comment server. Required while comments are on."
	},
	VISUAL_COMMENTS_SECRET: {
		description: "The space's secret, at least 32 characters. Required while comments are on. Never sent to browsers.",
		check: isSecret
	},
	VISUAL_COMMENTS_PATH: {
		description: 'Where the site answers comment requests, base path included. Default `/_comments`.',
		check: isPath
	},
	VISUAL_COMMENTS_AUTH: {
		description: "Where the site's sign-in routes are, base path included. Default `/auth`.",
		check: isPath
	},
	VISUAL_COMMENTS_OIDC_ISSUER: {
		description: "With the comments' own sign-in: the OpenID Connect provider, e.g. `https://id.convex.works`.",
		check: isUrl
	},
	VISUAL_COMMENTS_OIDC_CLIENT_ID: {
		description: "With the comments' own sign-in: their confidential client at the provider."
	},
	VISUAL_COMMENTS_OIDC_CLIENT_SECRET: {
		description: "With the comments' own sign-in: that client's secret."
	},
	VISUAL_COMMENTS_SESSION_SECRET: {
		description: "With the comments' own sign-in: encrypts their session cookie. At least 32 characters. Optional under the dev server.",
		check: isSecret
	}
};

export function invalid(name: CommentsEnvName, message: string): Error {
	return new Error(`${name} ${message}.`);
}

/** A variable's value, checked; undefined when unset or empty. */
export function read(env: CommentsEnv, name: CommentsEnvName): string | undefined {
	const value = env[name];
	if (typeof value !== 'string' || value === '') return undefined;
	const problem = CHECKS[name].check?.(value);
	if (problem) throw invalid(name, problem);
	return value;
}

/**
 * The variables for SvelteKit's `src/env.ts`, all private and read when the
 * app starts, so one build serves every deployment:
 *
 * ```ts
 * import { defineEnvVars } from '@sveltejs/kit/env';
 * import { commentsVariables } from 'visual-comments/server';
 *
 * export const variables = defineEnvVars({ ...commentsVariables });
 * ```
 */
export const commentsVariables = Object.fromEntries(
	Object.entries(CHECKS).map(([name, { description }]) => [name, {
		description,
		// Optional, and checked when the app starts.
		schema: (value: string | undefined) => read({ [name]: value }, name as CommentsEnvName)
	}])
) as { readonly [K in CommentsEnvName]: { description: string; schema: (value: string | undefined) => string | undefined } };
