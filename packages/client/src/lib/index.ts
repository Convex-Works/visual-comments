export { VisualComments, pageOf, type VisualCommentsOptions, type SurfaceInfo, type CommentFilters } from './visual-comments.svelte.js';
export type * from './shared/types.js';

import { VisualComments, type VisualCommentsOptions } from './visual-comments.svelte.js';

/** Adds comments to the page. Call once, in the browser. */
export function createVisualComments(options: VisualCommentsOptions, doc?: Document): VisualComments {
	return new VisualComments(options, doc);
}
