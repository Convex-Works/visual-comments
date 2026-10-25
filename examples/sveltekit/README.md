# SvelteKit example

A SvelteKit 3 app with comments set up from environment variables, and the
comments in a toolbar of its own, beside a tool of the app. See
[SvelteKit](../../README.md#sveltekit) for what each file does.

```sh
cp .env.example .env
pnpm dev            # in the repository's root first: the comment server on :4400
pnpm -F @visual-comments/example-sveltekit dev
```

Then open http://localhost:5173, sign in with any name, and press C.

- `src/env.ts` declares the `VISUAL_COMMENTS_*` variables.
- `src/lib/server/comments.ts` reads them; `.env` turns comments on under `vite dev` only.
- `src/hooks.server.ts` signs people in and passes comment requests on.
- `src/routes/+layout.server.ts` tells the browser where the comments are, or null while they are off.
- `src/routes/+layout.svelte` adds `Comments` and the `Toolbar`, with `page="route"`: both projects share their threads.
- `vite.config.ts` adds `visualComments()`, which leaves the comments out of `pnpm build` unless it runs with `VISUAL_COMMENTS_BUILD=true`.

`VISUAL_COMMENTS_ENABLED=false pnpm dev` shows the app without comments: no
comment button, no `/_comments` route, and none of the comments' code in the
browser.
