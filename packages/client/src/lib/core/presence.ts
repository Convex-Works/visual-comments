import type { Author, Participant, PresenceState } from '../shared/types.js';

/** Someone present, however many tabs or tasks they have. */
export interface Present {
	author: Author;
	/** Their busiest participant's state. */
	state: PresenceState;
	/** Busiest first. */
	participants: Participant[];
}

const RANK: Record<PresenceState, number> = { viewing: 0, typing: 1, working: 2 };

/** Participants grouped by who they are, in the order they arrived. */
export function present(participants: Participant[]): Present[] {
	const groups = new Map<string, Participant[]>();
	for (const participant of participants) {
		const group = groups.get(participant.author.sub);
		if (group) group.push(participant);
		else groups.set(participant.author.sub, [participant]);
	}
	return [...groups.values()].map((group) => {
		group.sort((a, b) => RANK[b.state] - RANK[a.state]);
		return { author: group[0].author, state: group[0].state, participants: group };
	});
}

/** What a participant is doing, as a sentence, or undefined while they only look. */
export function activity(participant: Participant): string | undefined {
	const { name } = participant.author;
	if (participant.state === 'typing') return `${name} is typing…`;
	if (participant.state === 'working') return participant.note ? `${name} is working: ${participant.note}` : `${name} is working…`;
	return undefined;
}
