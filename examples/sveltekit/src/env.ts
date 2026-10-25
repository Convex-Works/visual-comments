// The app's environment variables. The comments' are private and read when the
// app starts, so each deployment turns comments on or off without a new build.
import { defineEnvVars } from '@sveltejs/kit/env';
import { commentsVariables } from 'visual-comments/server';

export const variables = defineEnvVars({ ...commentsVariables });
