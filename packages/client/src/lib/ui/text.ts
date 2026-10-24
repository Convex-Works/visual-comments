import type { Author, Comment } from '../shared/types.js';

/** A comment's text for previews, or what it holds when it is only images. */
export function commentText(comment: Comment): string {
	if (comment.body) return comment.body;
	const count = comment.images?.length ?? 0;
	return count === 1 ? 'Image' : `${count} images`;
}

/** Who someone is, saying who added them when they are an agent. */
export function authorLabel(author: Author): string {
	return author.agent ? `${author.name} · added by ${author.agent.addedBy.name}` : author.name;
}
