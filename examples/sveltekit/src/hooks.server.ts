import { createSignIn } from '@convex-works/sign-in/server';
import { sequence } from '@sveltejs/kit/hooks';
import { comments } from '#lib/server/comments.js';

// Without OIDC settings the development sign-in takes any name. A real app
// keeps its own sign-in here, as long as it sets `event.locals.user`.
const signIn = createSignIn({ devLogin: true });

export const handle = sequence(signIn.sveltekit(), comments.sveltekit());
