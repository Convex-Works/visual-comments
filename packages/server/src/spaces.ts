import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * A space holds one team's threads. Spaces come from configuration, not from
 * the database:
 *
 * ```json
 * {
 *   "my-team": { "name": "Team prototype", "secret": "…" }
 * }
 * ```
 *
 * The site's server sends the secret with every request, and says who is
 * signed in; the site decides who that may be. Each site has its own space
 * and secret. `"agents": false` keeps agents out of the space.
 */
export interface Space {
	id: string;
	name: string;
	secret: string;
	/** Whether people may let agents join. Default true. */
	agents: boolean;
}

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const hash = (value: string) => createHash('sha256').update(value).digest();

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
			if (!ID.test(id)) throw new Error(`Space id “${id}” must be lowercase letters, digits and dashes`);
			if (typeof space?.secret !== 'string' || space.secret.length < 32) {
				throw new Error(`Space “${id}” needs a secret of at least 32 characters`);
			}
			if (space.agents !== undefined && typeof space.agents !== 'boolean') {
				throw new Error(`Space “${id}”: agents must be true or false`);
			}
			list.push({ id, name: typeof space.name === 'string' ? space.name : id, secret: space.secret, agents: space.agents !== false });
		}
		return new Spaces(list);
	}

	get(id: string): Space | undefined {
		return this.spaces.get(id);
	}
}

/** Whether a request carries the space's secret. */
export function hasSecret(space: Space, value: string | undefined): boolean {
	return value !== undefined && timingSafeEqual(hash(value), hash(space.secret));
}
