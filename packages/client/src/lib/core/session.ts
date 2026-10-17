// The sign-in for one space on one comment server. The server signs people in
// on its own origin and gives the page a token for the space, so nothing here
// depends on third-party cookies. The token is kept in this site's storage.

import type { Viewer } from '../shared/types.js';

const POPUP = 'visual-comments-sign-in';

export class Session {
	readonly server: string;
	readonly space: string;
	token: string | null;
	/** The last sign-in failure, to show once. */
	error: string | null = null;
	private key: string;
	private listeners = new Set<() => void>();

	constructor(server: string, space: string) {
		this.server = server.replace(/\/$/, '');
		this.space = space;
		this.key = `visual-comments:${this.server}:${space}`;
		this.token = read(this.key);
	}

	/** Called when the token changes: signed in here, in a popup, in another tab, or out. */
	onChange(listener: () => void) {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private set(token: string | null) {
		this.token = token;
		write(this.key, token);
		for (const listener of this.listeners) listener();
	}

	/**
	 * Picks up a sign-in that came back in the address's fragment, and listens
	 * for one from a popup or another tab. A popup that came back here (its
	 * opener was cut off) hands the token over through storage and closes.
	 */
	start(): () => void {
		const hash = new URLSearchParams(location.hash.slice(1));
		if (hash.get('vc-space') === this.space) {
			const token = hash.get('vc-token');
			this.error = hash.get('vc-error');
			const before = read(`${this.key}:hash`);
			remove(`${this.key}:hash`);
			history.replaceState(history.state, '', `${location.pathname}${location.search}${before ?? ''}`);
			if (token) this.set(token);
			// The popup's copy of the page: the token is in storage now, where the opener picks it up.
			if (hash.has('vc-popup')) window.close();
		}
		const onstorage = (event: StorageEvent) => {
			if (event.key === this.key) {
				this.token = event.newValue ? JSON.parse(event.newValue) : null;
				for (const listener of this.listeners) listener();
			}
		};
		const onmessage = (event: MessageEvent) => {
			const data = event.data as { type?: string; space?: string; token?: string; error?: string } | null;
			if (event.origin !== new URL(this.server).origin || data?.space !== this.space) return;
			if (data.type === 'visual-comments:signed-in' && typeof data.token === 'string') {
				this.error = null;
				this.set(data.token);
			} else if (data.type === 'visual-comments:error') {
				this.error = data.error ?? 'Could not sign you in.';
				for (const listener of this.listeners) listener();
			}
		};
		window.addEventListener('storage', onstorage);
		window.addEventListener('message', onmessage);
		return () => {
			window.removeEventListener('storage', onstorage);
			window.removeEventListener('message', onmessage);
		};
	}

	/** Signs in in a popup, or by leaving the page and coming back when popups are blocked. */
	signIn() {
		const back = `${location.origin}${location.pathname}${location.search}`;
		const url = (mode: string) => `${this.server}/auth/login?${new URLSearchParams({ space: this.space, return: back, mode })}`;
		const width = 480;
		const height = 640;
		const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
		const top = Math.round(window.screenY + (window.outerHeight - height) / 3);
		const popup = window.open(url('popup'), POPUP, `popup,width=${width},height=${height},left=${left},top=${top}`);
		if (popup) return;
		// The fragment the page has now comes back after the sign-in.
		write(`${this.key}:hash`, location.hash);
		location.assign(url('redirect'));
	}

	async signOut() {
		const token = this.token;
		this.set(null);
		if (token) {
			await fetch(`${this.server}/v1/spaces/${this.space}/session`, {
				method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
			}).catch(() => {});
		}
	}

	/** A request to the space's endpoints, signed in when there is a token. */
	async fetch(path: string, init: RequestInit = {}): Promise<Response> {
		const headers = new Headers(init.headers);
		const token = this.token;
		if (token) headers.set('Authorization', `Bearer ${token}`);
		const response = await fetch(`${this.server}/v1/spaces/${this.space}${path}`, { ...init, headers, cache: 'no-store' });
		if (response.status === 401 && token && this.token === token) this.set(null);
		return response;
	}

	/** Whether a snapshot says the token no longer signs anyone in. */
	expired(viewer: Viewer | null) {
		if (!viewer && this.token) this.set(null);
	}
}

// Storage can be unavailable (private windows, blocked site data): fall back to memory.
const memory = new Map<string, string>();

function read(key: string): string | null {
	try {
		const raw = localStorage.getItem(key);
		return raw === null ? null : JSON.parse(raw);
	} catch {
		return memory.has(key) ? JSON.parse(memory.get(key)!) : null;
	}
}

function write(key: string, value: string | null) {
	if (value === null) return remove(key);
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		memory.set(key, JSON.stringify(value));
	}
}

function remove(key: string) {
	try {
		localStorage.removeItem(key);
	} catch {
		memory.delete(key);
	}
}
