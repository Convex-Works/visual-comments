// The comments on the site's own server, which passes requests on to the
// comment server with the space's secret and the person signed in on the site.

export class Api {
	readonly endpoint: string;

	constructor(endpoint: string) {
		this.endpoint = endpoint.replace(/\/$/, '');
	}

	fetch(path: string, init: RequestInit = {}): Promise<Response> {
		return fetch(`${this.endpoint}${path}`, { ...init, credentials: 'same-origin', cache: 'no-store' });
	}
}
