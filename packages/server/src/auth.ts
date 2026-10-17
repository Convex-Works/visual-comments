import { randomBytes } from 'node:crypto';
import * as oidc from 'openid-client';
import { allowsMember, allowsOrigin, type Space, type Spaces } from './spaces.ts';
import type { CommentStore } from './store.ts';
import type { Viewer } from '../../client/src/lib/shared/types.ts';

export interface AuthConfig {
	/** Where this server is reached, e.g. `https://comments.convex.works`. */
	publicUrl: string;
	oidc?: {
		issuer: string;
		clientId: string;
		clientSecret: string;
		scope?: string;
	};
	/**
	 * Sign in as anyone, with a name and address typed in a form. Only for a
	 * server on localhost, to work without an identity provider.
	 */
	devLogin?: boolean;
}

/** The person, as the identity provider describes them. */
interface Identity extends Viewer {
	groups: string[];
}

const LOGIN_COOKIE = 'vc_login';
const noStore = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

/**
 * Sign-in for every space, on this server's own origin. A site opens
 * `/auth/login` in a popup (or navigates to it); after the identity provider
 * signs the person in, the server gives the site a token for one space:
 * by `postMessage` to the opener, or in the fragment of the address to return
 * to when the popup lost its opener or there was none.
 */
export class Auth {
	private config: AuthConfig;
	private store: CommentStore;
	private spaces: Spaces;
	private discovery?: Promise<oidc.Configuration>;
	private secure: boolean;

	constructor(config: AuthConfig, store: CommentStore, spaces: Spaces) {
		this.config = config;
		this.store = store;
		this.spaces = spaces;
		const url = new URL(config.publicUrl);
		this.secure = url.protocol === 'https:';
		if (config.devLogin && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
			throw new Error('Development sign-in only runs on localhost');
		}
	}

	get configured(): boolean {
		return Boolean(this.config.oidc?.clientId && this.config.oidc.clientSecret) || Boolean(this.config.devLogin);
	}

	private get callbackUrl() {
		return new URL('/auth/callback', this.config.publicUrl).href;
	}

	private configuration(): Promise<oidc.Configuration> {
		const settings = this.config.oidc!;
		if (!this.discovery) {
			const issuer = new URL(settings.issuer);
			this.discovery = oidc.discovery(issuer, settings.clientId, settings.clientSecret,
				oidc.ClientSecretPost(settings.clientSecret), {
					timeout: 15,
					execute: issuer.protocol === 'http:'
						? [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks]
						: [oidc.enableNonRepudiationChecks]
				}).catch((error) => { this.discovery = undefined; throw error; });
		}
		return this.discovery;
	}

	async handle(request: Request, url: URL): Promise<Response | undefined> {
		if (!url.pathname.startsWith('/auth/')) return undefined;
		try {
			if (url.pathname === '/auth/login' && request.method === 'GET') return await this.login(request, url);
			if (url.pathname === '/auth/callback' && request.method === 'GET') return await this.callback(request, url);
			if (url.pathname === '/auth/dev' && request.method === 'POST' && this.config.devLogin) return await this.devCallback(request);
		} catch (error) {
			console.error('[visual-comments] Sign-in failed', error);
			return page('Sign-in failed', 'Something went wrong while signing you in. Close this window and try again.', 500);
		}
		return new Response('Not found', { status: 404, headers: noStore });
	}

	/** The space and the address to return to, if that address is on one of the space's sites. */
	private target(url: URL): { space: Space; back: URL; mode: 'popup' | 'redirect' } | Response {
		const space = this.spaces.get(url.searchParams.get('space') ?? '');
		if (!space) return page('No such space', 'This site asked to sign in to a space that does not exist.', 404);
		let back: URL;
		try {
			back = new URL(url.searchParams.get('return') ?? '');
		} catch {
			return page('Cannot sign in', 'This sign-in link is incomplete.', 400);
		}
		if (!allowsOrigin(space, back.origin)) {
			return page('Cannot sign in', `${back.origin} cannot show the comments of “${space.name}”.`, 403);
		}
		back.hash = '';
		return { space, back, mode: url.searchParams.get('mode') === 'redirect' ? 'redirect' : 'popup' };
	}

	private async login(request: Request, url: URL): Promise<Response> {
		const target = this.target(url);
		if (target instanceof Response) return target;
		const { space, back, mode } = target;
		if (!this.config.oidc?.clientSecret) {
			if (this.config.devLogin) return devForm(space, back, mode);
			return page('Sign-in is not set up', 'This comment server has no identity provider.', 503);
		}
		const config = await this.configuration();
		const verifier = oidc.randomPKCECodeVerifier();
		const binding = randomBytes(24).toString('base64url');
		const state = oidc.randomState();
		const nonce = oidc.randomNonce();
		this.store.saveLogin({ state, binding, nonce, verifier, space: space.id, mode, target: back.href });
		const destination = oidc.buildAuthorizationUrl(config, {
			redirect_uri: this.callbackUrl, response_type: 'code',
			scope: this.config.oidc.scope ?? 'openid profile email groups',
			state, nonce,
			code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256'
		});
		const response = new Response(null, { status: 303, headers: { ...noStore, Location: destination.href } });
		response.headers.append('Set-Cookie', this.cookie(binding, 600));
		return response;
	}

	private cookie(value: string, maxAge: number) {
		return `${LOGIN_COOKIE}=${value}; Path=/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.secure ? '; Secure' : ''}`;
	}

	private async callback(request: Request, url: URL): Promise<Response> {
		const binding = cookies(request).get(LOGIN_COOKIE);
		const login = this.store.takeLogin(url.searchParams.get('state') ?? '', binding);
		const clear = (response: Response) => {
			response.headers.append('Set-Cookie', this.cookie('', 0));
			return response;
		};
		if (!login) return clear(page('Sign-in expired', 'This sign-in took too long or was started in another browser. Close this window and try again.', 400));
		const space = this.spaces.get(login.space);
		if (!space) return clear(page('No such space', 'This space no longer exists.', 404));
		let identity: Identity;
		try {
			// The provider redirected to the public address; match it exactly, whatever proxy is in front.
			const current = new URL(`${url.pathname}${url.search}`, this.config.publicUrl);
			const tokens = await oidc.authorizationCodeGrant(await this.configuration(), current, {
				pkceCodeVerifier: login.verifier, expectedState: login.state, expectedNonce: login.nonce, idTokenExpected: true
			});
			identity = profile(tokens.claims()!);
		} catch (error) {
			const cancelled = error instanceof oidc.AuthorizationResponseError && error.error === 'access_denied';
			return clear(this.finish(space, login.mode, new URL(login.target), {
				error: cancelled ? 'Sign-in was cancelled.' : 'Your sign-in could not be verified. Try again.'
			}));
		}
		return clear(this.complete(space, login.mode, new URL(login.target), identity));
	}

	private async devCallback(request: Request): Promise<Response> {
		if (request.headers.get('origin') !== new URL(this.config.publicUrl).origin) {
			return new Response('Invalid request origin', { status: 403, headers: noStore });
		}
		const form = await request.formData();
		const query = new URL(`/auth/login?${new URLSearchParams({
			space: String(form.get('space') ?? ''), return: String(form.get('return') ?? ''), mode: String(form.get('mode') ?? '')
		})}`, this.config.publicUrl);
		const target = this.target(query);
		if (target instanceof Response) return target;
		const name = String(form.get('name') ?? '').trim().slice(0, 100) || 'Local viewer';
		const email = String(form.get('email') ?? '').trim().toLowerCase().slice(0, 200) || undefined;
		const sub = `dev:${email ?? name.toLowerCase()}`;
		return this.complete(target.space, target.mode, target.back, { sub, name, email, groups: [] });
	}

	private complete(space: Space, mode: 'popup' | 'redirect', back: URL, identity: Identity): Response {
		const member = allowsMember(space, identity.email)
			|| space.members.some((rule) => rule.startsWith('group:') && identity.groups.includes(rule.slice(6)));
		if (!member) {
			return this.finish(space, mode, back, {
				error: `${identity.email ?? identity.name} is not a member of “${space.name}”.`
			});
		}
		const { groups: _, ...viewer } = identity;
		const token = this.store.createSession(viewer, space.id);
		return this.finish(space, mode, back, { token, viewer });
	}

	/**
	 * Hands the result to the site. A popup posts it to its opener, only at the
	 * site's origin. Without an opener (none, or cut off by the provider's
	 * opener policy) it returns to the site with the result in the fragment;
	 * the site picks it up there, and a popup's copy passes it to its opener
	 * through storage.
	 */
	private finish(space: Space, mode: 'popup' | 'redirect', back: URL,
		result: { token: string; viewer: Viewer } | { error: string }): Response {
		const fragment = new URLSearchParams({ 'vc-space': space.id });
		if ('token' in result) fragment.set('vc-token', result.token);
		else fragment.set('vc-error', result.error);
		const returnTo = `${back.href}#${fragment}`;
		if (mode === 'redirect') return new Response(null, { status: 303, headers: { ...noStore, Location: returnTo } });
		// A popup that lost its opener loads the site itself; the mark tells it to pass the result on and close.
		const popupReturn = `${returnTo}&vc-popup=1`;
		const message = 'token' in result
			? { type: 'visual-comments:signed-in', space: space.id, token: result.token, viewer: result.viewer }
			: { type: 'visual-comments:error', space: space.id, error: result.error };
		const nonce = randomBytes(16).toString('base64');
		const data = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
		const body = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${'token' in result ? 'Signed in' : 'Not signed in'}</title>${STYLE}
<main><p>${escape('token' in result ? `Signed in to “${space.name}”. You can close this window.` : result.error)}</p></main>
<script nonce="${nonce}">
	const message = ${data(message)};
	if (window.opener) {
		window.opener.postMessage(message, ${data(back.origin)});
		window.close();
	} else {
		location.replace(${data(popupReturn)});
	}
</script></html>`;
		return new Response(body, {
			status: 200,
			headers: {
				...noStore,
				'Content-Type': 'text/html; charset=utf-8',
				'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-ancestors 'none'`,
				'Referrer-Policy': 'no-referrer'
			}
		});
	}
}

function profile(claims: oidc.IDToken): Identity {
	const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
	let picture = text(claims.picture);
	if (picture && !/^https:\/\//.test(picture)) picture = undefined;
	// An address the provider says is unverified does not count for membership.
	const email = claims.email_verified === false ? undefined : text(claims.email)?.toLowerCase();
	return {
		sub: claims.sub,
		name: text(claims.name) ?? text(claims.display_name)
			?? text([claims.given_name, claims.family_name].filter((part) => typeof part === 'string').join(' '))
			?? text(claims.preferred_username) ?? email ?? 'Account',
		...(email ? { email } : {}),
		...(picture ? { picture } : {}),
		groups: Array.isArray(claims.groups) ? claims.groups.filter((group): group is string => typeof group === 'string') : []
	};
}

function cookies(request: Request): Map<string, string> {
	const map = new Map<string, string>();
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const index = part.indexOf('=');
		if (index > 0) map.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
	}
	return map;
}

const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const STYLE = `<style>
	body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #292524; background: #f5f5f4; }
	main { max-width: 22rem; margin: 18vh auto; padding: 1.5rem; background: #fff; border-radius: 12px; box-shadow: 0 2px 14px rgb(0 0 0 / 0.12); }
	label { display: block; margin-top: 0.75rem; font-weight: 500; }
	input { box-sizing: border-box; width: 100%; margin-top: 0.25rem; padding: 0.4rem 0.6rem; font: inherit; border: 1px solid #d6d3d1; border-radius: 6px; }
	button { margin-top: 1rem; height: 2rem; padding: 0 1rem; font: inherit; font-weight: 500; color: #fff; background: #0d99ff; border: 0; border-radius: 999px; cursor: pointer; }
	h1 { margin: 0; font-size: 1rem; }
	p { margin: 0.5rem 0 0; }
</style>`;

function page(title: string, message: string, status: number): Response {
	return new Response(
		`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title>${STYLE}<main><h1>${escape(title)}</h1><p>${escape(message)}</p></main></html>`,
		{
			status,
			headers: {
				...noStore,
				'Content-Type': 'text/html; charset=utf-8',
				'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
			}
		}
	);
}

function devForm(space: Space, back: URL, mode: string): Response {
	const hidden = (name: string, value: string) => `<input type="hidden" name="${name}" value="${escape(value)}">`;
	return new Response(
		`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Sign in</title>${STYLE}
<main><h1>Sign in to “${escape(space.name)}”</h1><p>Development sign-in: no identity provider checks who you are.</p>
<form method="post" action="/auth/dev">${hidden('space', space.id)}${hidden('return', back.href)}${hidden('mode', mode)}
<label>Name <input name="name" value="Local viewer" autofocus></label>
<label>Email <input name="email" type="email" placeholder="you@example.com"></label>
<button type="submit">Sign in</button></form></main></html>`,
		{
			headers: {
				...noStore,
				'Content-Type': 'text/html; charset=utf-8',
				// The form's answer may redirect back to the site, which form-action also governs.
				'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${back.origin}; frame-ancestors 'none'`
			}
		}
	);
}
