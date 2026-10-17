import { readFileSync } from 'node:fs';

/**
 * A space holds one team's threads, for the sites it lists. Spaces come from
 * configuration, not from the database:
 *
 * ```json
 * {
 *   "my-team": {
 *     "name": "Team prototype",
 *     "origins": ["https://app.example.com", "http://localhost:*"],
 *     "members": ["*@convex.works", "*@partner.example"]
 *   }
 * }
 * ```
 *
 * `origins` are the sites that can show the space's comments: exact origins,
 * `https://*.example.com` for any subdomain, or `http://localhost:*` for any
 * port. `members` say who can sign in: `*@example.com` for a domain, an
 * exact address, or `*` for anyone the identity provider signs in.
 */
export interface Space {
	id: string;
	name: string;
	origins: string[];
	members: string[];
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class Spaces {
	private spaces = new Map<string, Space>();

	constructor(spaces: Space[]) {
		for (const space of spaces) this.spaces.set(space.id, space);
	}

	/** From JSON, or from the JSON file a path names. */
	static load(value: string): Spaces {
		const text = value.trim().startsWith('{') ? value : readFileSync(value, 'utf8');
		return Spaces.parse(JSON.parse(text));
	}

	static parse(config: unknown): Spaces {
		if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Spaces must be an object of spaces by id');
		const list: Space[] = [];
		for (const [id, value] of Object.entries(config as Record<string, unknown>)) {
			const space = value as Partial<Space> | null;
			const strings = (list: unknown) => Array.isArray(list) && list.every((item) => typeof item === 'string');
			if (!ID.test(id)) throw new Error(`Space id “${id}” must be lowercase letters, digits and dashes`);
			if (!space || !strings(space.origins) || !strings(space.members)) {
				throw new Error(`Space “${id}” needs lists of origins and members`);
			}
			for (const origin of space.origins!) originPattern(origin);
			list.push({ id, name: typeof space.name === 'string' ? space.name : id, origins: space.origins!, members: space.members! });
		}
		return new Spaces(list);
	}

	get(id: string): Space | undefined {
		return this.spaces.get(id);
	}
}

/** Whether a site can show the space's comments. */
export function allowsOrigin(space: Space, origin: string | null | undefined): boolean {
	if (!origin) return false;
	return space.origins.some((pattern) => originPattern(pattern).test(origin));
}

/** Whether a person can sign in to the space. Needs an address the provider has not marked unverified. */
export function allowsMember(space: Space, email: string | undefined): boolean {
	if (space.members.includes('*')) return true;
	if (!email) return false;
	const address = email.toLowerCase();
	return space.members.some((member) => {
		const rule = member.toLowerCase();
		return rule.startsWith('*@') ? address.endsWith(rule.slice(1)) : address === rule;
	});
}

const patterns = new Map<string, RegExp>();

function originPattern(pattern: string): RegExp {
	let regex = patterns.get(pattern);
	if (regex) return regex;
	const match = /^([a-z][a-z0-9+.-]*):\/\/(\*\.)?([^/:*]+)(?::(\d+|\*))?$/.exec(pattern);
	if (!match) throw new Error(`Invalid origin “${pattern}”: use scheme://host, scheme://*.host or scheme://host:*`);
	const [, scheme, wildcard, host, port] = match;
	const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	regex = new RegExp(
		`^${escape(scheme)}://${wildcard ? '(?:[a-z0-9-]+\\.)+' : ''}${escape(host)}` +
		`${port === '*' ? '(?::\\d+)?' : port ? `:${port}` : ''}$`
	);
	patterns.set(pattern, regex);
	return regex;
}
