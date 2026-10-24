import { randomBytes } from 'node:crypto';
import { CommentError } from './store.ts';
import type { Author, Participant, PresenceState, Viewer } from '../../client/src/lib/shared/types.ts';

export interface PresenceOptions {
	/** `typing` falls back to `viewing` this long after its last update; clients heartbeat while typing. */
	typingMs?: number;
	/** An agent without an open request stays present this long after its last request. */
	agentMs?: number;
	/** Changes in a space this close together go out as one `change` event. */
	coalesceMs?: number;
}

/** A participant as `POST /presence` sets it: every field it leaves out is cleared. */
export interface PresenceInput {
	state: PresenceState;
	page?: string;
	surface?: string;
	thread?: number;
	note?: string;
}

interface Entry {
	participant: Participant;
	agent?: string;
	typing?: NodeJS.Timeout;
}

/** How long an agent stays: its open requests, and the grace after its last one. */
interface AgentLife {
	open: Set<() => void>;
	timer?: NodeJS.Timeout;
}

interface SpacePresence {
	participants: Map<string, Entry>;
	/** People's open event streams, by connection id, with whose they are. */
	connections: Map<string, string>;
	agents: Map<string, AgentLife>;
	flush?: NodeJS.Timeout;
}

/**
 * Who is in each space right now, in memory: one server instance holds every
 * space's streams. People are present while their event stream is open, one
 * participant per stream; agents while they are making requests, viewing
 * from the moment they arrive, plus one participant per key they post.
 */
export class Presence {
	/** Dispatches `change` with the space as its detail, at most once per `coalesceMs` per space. */
	readonly events = new EventTarget();
	private spaces = new Map<string, SpacePresence>();
	private typingMs: number;
	private agentMs: number;
	private coalesceMs: number;

	constructor(options: PresenceOptions = {}) {
		this.typingMs = options.typingMs ?? 10_000;
		this.agentMs = options.agentMs ?? 60_000;
		this.coalesceMs = options.coalesceMs ?? 100;
	}

	private space(id: string): SpacePresence {
		let space = this.spaces.get(id);
		if (!space) this.spaces.set(id, space = { participants: new Map(), connections: new Map(), agents: new Map() });
		return space;
	}

	participants(space: string): Participant[] {
		return [...this.space(space).participants.values()].map((entry) => entry.participant);
	}

	/** Whether someone is typing in a thread. */
	typing(space: string, sub: string, thread: number): boolean {
		return this.participants(space).some((p) => p.author.sub === sub && p.state === 'typing' && p.thread === thread);
	}

	/** A person's event stream opened: they are viewing until it closes. Returns its connection id. */
	connect(space: string, viewer: Viewer): string {
		const id = randomBytes(16).toString('base64url');
		const state = this.space(space);
		state.connections.set(id, viewer.sub);
		state.participants.set(id, { participant: { id, author: authorOf(viewer), state: 'viewing', since: Date.now() } });
		this.notify(space);
		return id;
	}

	disconnect(space: string, connection: string) {
		const state = this.space(space);
		state.connections.delete(connection);
		if (this.remove(state, connection)) this.notify(space);
	}

	/**
	 * An agent's request that stays open, such as its inbox or event stream:
	 * the agent is present until the returned release. `end` is called instead
	 * when the agent is removed first.
	 */
	hold(space: string, agent: string, end: () => void): () => void {
		const life = this.life(space, agent);
		life.open.add(end);
		return () => {
			// Stale once the agent was removed.
			if (this.space(space).agents.get(agent) !== life || !life.open.delete(end)) return;
			this.extend(space, agent, life);
		};
	}

	/**
	 * An agent made a request: it stays present for `agentMs`, longer while a
	 * request is open. An agent that arrives is seen viewing, so one that only
	 * listens still shows; posting its default key replaces that.
	 */
	touch(space: string, viewer: Viewer, agent: string) {
		const state = this.space(space);
		const arriving = !state.agents.has(agent);
		this.extend(space, agent, this.life(space, agent));
		if (!arriving) return;
		const id = `agent:${agent}:`;
		state.participants.set(id, { participant: { id, author: authorOf(viewer), state: 'viewing', since: Date.now() }, agent });
		this.notify(space);
	}

	/** Restarts the grace after an agent's last request. */
	private extend(space: string, agent: string, life: AgentLife) {
		clearTimeout(life.timer);
		life.timer = setTimeout(() => {
			if (!life.open.size) this.removeAgent(space, agent);
		}, this.agentMs);
		life.timer.unref();
	}

	/** The agent left or was removed: its participants go, its open requests end. */
	removeAgent(space: string, agent: string) {
		const state = this.space(space);
		const life = state.agents.get(agent);
		if (life) {
			state.agents.delete(agent);
			clearTimeout(life.timer);
			for (const end of life.open) end();
		}
		let changed = false;
		for (const [id, entry] of state.participants) if (entry.agent === agent) changed = this.remove(state, id) || changed;
		if (changed) this.notify(space);
	}

	/**
	 * Sets a participant: a person's by their connection, an agent's by its key.
	 * `since` only moves when the state changes.
	 */
	update(space: string, viewer: Viewer, target: { connection: string } | { agent: string; key: string }, input: PresenceInput | 'gone') {
		const state = this.space(space);
		let id: string;
		if ('connection' in target) {
			// Only the viewer's own streams, so nobody can speak for another tab.
			if (state.connections.get(target.connection) !== viewer.sub) throw new CommentError(404, 'This connection is closed. Reconnect.');
			id = target.connection;
		} else id = `agent:${target.agent}:${target.key}`;
		const previous = state.participants.get(id);
		if (input === 'gone') {
			if (this.remove(state, id)) this.notify(space);
			return;
		}
		clearTimeout(previous?.typing);
		const participant: Participant = {
			id,
			author: authorOf(viewer),
			state: input.state,
			...(input.page !== undefined ? { page: input.page } : {}),
			...(input.surface !== undefined ? { surface: input.surface } : {}),
			...(input.thread !== undefined ? { thread: input.thread } : {}),
			...(input.note !== undefined ? { note: input.note } : {}),
			since: previous?.participant.state === input.state ? previous.participant.since : Date.now()
		};
		const entry: Entry = { participant, ...('agent' in target ? { agent: target.agent } : {}) };
		if (input.state === 'typing') {
			entry.typing = setTimeout(() => {
				entry.typing = undefined;
				participant.state = 'viewing';
				participant.since = Date.now();
				this.notify(space);
			}, this.typingMs);
			entry.typing.unref();
		}
		state.participants.set(id, entry);
		this.notify(space);
	}

	private life(space: string, agent: string): AgentLife {
		const agents = this.space(space).agents;
		let life = agents.get(agent);
		if (!life) agents.set(agent, life = { open: new Set() });
		return life;
	}

	private remove(state: SpacePresence, id: string): boolean {
		const entry = state.participants.get(id);
		if (!entry) return false;
		clearTimeout(entry.typing);
		state.participants.delete(id);
		return true;
	}

	private notify(space: string) {
		const state = this.space(space);
		if (state.flush) return;
		state.flush = setTimeout(() => {
			state.flush = undefined;
			this.events.dispatchEvent(new CustomEvent('change', { detail: space }));
		}, this.coalesceMs);
		state.flush.unref();
	}
}

/** What others see of someone: never their email. */
function authorOf({ sub, name, picture, agent }: Viewer): Author {
	return { sub, name, ...(picture ? { picture } : {}), ...(agent ? { agent } : {}) };
}
