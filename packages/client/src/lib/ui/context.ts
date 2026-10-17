import { getContext, setContext } from 'svelte';
import type { VisualComments } from '../visual-comments.svelte.js';

const KEY = Symbol('visual-comments');

export function setComments(vc: VisualComments) {
	setContext(KEY, vc);
}

export function useComments(): VisualComments {
	return getContext<VisualComments>(KEY);
}
