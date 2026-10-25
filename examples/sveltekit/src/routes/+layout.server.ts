import { comments } from '#lib/server/comments.js';
import type { LayoutServerLoad } from './$types';

// Where the browser reaches the comments, or null while they are off.
export const load: LayoutServerLoad = async (event) => ({ comments: await comments.load(event) });
