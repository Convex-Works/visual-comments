// Comments, as this deployment's environment sets them up. Off unless
// VISUAL_COMMENTS_ENABLED is true, or dev while `vite dev` runs.
import { dev } from '$app/env';
import * as env from '$app/env/private';
import { commentsFromEnv } from 'visual-comments/server';

export const comments = commentsFromEnv(env, { dev });
