// `visual-comments/sveltekit`: comments in a SvelteKit app. The server side,
// set up from environment variables, is `commentsFromEnv` of `visual-comments/server`.
export { default as Comments, type CommentsProps } from './Comments.svelte';
export { default as Toolbar } from './Toolbar.svelte';
export { default as ToolbarButton } from './ToolbarButton.svelte';
export { useComments, type AppComments } from './context.js';
export type { CommentsClientConfig } from '../server/env.js';
export type { VisualComments, VisualCommentsOptions } from '../visual-comments.svelte.js';
