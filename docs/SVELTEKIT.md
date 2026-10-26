# SvelteKit

`visual-comments/sveltekit` adds comments to a SvelteKit app (2.12 or later;
the examples here are SvelteKit 3). Environment variables decide, per
deployment, whether there are comments at all: say on in development and
staging, and absent in production, from the same build. While they are off,
the site answers no comment requests and the browser never downloads the
comments' code; the [Vite plugin](#out-of-production-builds) leaves it out
of a build altogether. The app's server signs people in, as with the
[proxy](PROTOCOL.md), or the comments [do it themselves](#their-own-sign-in).
[examples/sveltekit](../examples/sveltekit) is a working app.

```sh
pnpm add visual-comments
```

**1. The variables.** In `src/env.ts`, with the app's own:

```ts
import { defineEnvVars } from '@sveltejs/kit/env';
import { commentsVariables } from 'visual-comments/server';

export const variables = defineEnvVars({ ...commentsVariables });
```

All are private, read when the app starts, and checked then:

| Variable | Meaning |
|---|---|
| `VISUAL_COMMENTS_ENABLED` | `true`, `false` or `dev` (only while `vite dev` runs). Default `false`: comments are off unless turned on. |
| `VISUAL_COMMENTS_SERVER` | The comment server, e.g. `https://comments.convex.works`. |
| `VISUAL_COMMENTS_SPACE` | The site's space on it. |
| `VISUAL_COMMENTS_SECRET` | The space's secret, at least 32 characters. Never sent to browsers. |
| `VISUAL_COMMENTS_PATH` | Where the site answers comment requests, base path included. Default `/_comments`. |
| `VISUAL_COMMENTS_AUTH` | Where the site's sign-in routes are, base path included. Default `/auth`. |
| `VISUAL_COMMENTS_OIDC_ISSUER`, `VISUAL_COMMENTS_OIDC_CLIENT_ID`, `VISUAL_COMMENTS_OIDC_CLIENT_SECRET`, `VISUAL_COMMENTS_SESSION_SECRET` | Only for the comments' [own sign-in](#their-own-sign-in). |

While comments are on, the server, space and secret must be set: a missing
or invalid value stops the app at start, not when someone first comments.
For example, `.env` in development:

```sh
VISUAL_COMMENTS_ENABLED=dev
VISUAL_COMMENTS_SERVER=http://localhost:4400
VISUAL_COMMENTS_SPACE=demo
VISUAL_COMMENTS_SECRET=development-only-secret-for-the-demo-space
```

and in staging the same with `VISUAL_COMMENTS_ENABLED=true` and the real
server and secret. Production sets none of them.

**2. The server.** One module reads them, `src/lib/server/comments.ts`:

```ts
import { dev } from '$app/env';
import * as env from '$app/env/private';
import { commentsFromEnv } from 'visual-comments/server';

export const comments = commentsFromEnv(env, { dev });
```

Its hook goes after the sign-in's, in `src/hooks.server.ts`. Off, it passes
every request on:

```ts
import { sequence } from '@sveltejs/kit/hooks';
import { createSignIn } from '@cnvx/sign-in/server';
import { comments } from '#lib/server/comments.js';

export const handle = sequence(createSignIn({ /* … */ }).sveltekit(), comments.sveltekit());
```

The root layout's `load`, in `src/routes/+layout.server.ts`, tells the
browser where the comments are, or null while they are off. With their
[own sign-in](#their-own-sign-in) it also says who is signed in to them, so
the toolbar shows it as the page renders:

```ts
import { comments } from '#lib/server/comments.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => ({ comments: await comments.load(event) });
```

**3. The pages.** `Comments` goes around them in `src/routes/+layout.svelte`,
with a `Toolbar`:

```svelte
<script lang="ts">
  import { Comments, Toolbar, ToolbarButton } from 'visual-comments/sveltekit';
  import InspectIcon from '#lib/InspectIcon.svelte';
  let { data, children } = $props();
  let inspecting = $state(false);
</script>

<Comments config={data.comments}>
  {@render children()}
  <Toolbar>
    <!-- the app's own tools, if any; then the comment button and the account -->
    <ToolbarButton label="Inspect" pressed={inspecting} onclick={() => (inspecting = !inspecting)}>
      <InspectIcon />
    </ToolbarButton>
  </Toolbar>
</Comments>
```

`Comments` starts the comments in the browser, and stops them when it goes.
A thread on another page opens there by navigating in the app, so the page is
not loaded anew. Besides `config`, it takes the library's options
([LIBRARY.md](LIBRARY.md): `show`, `describe`, `context`, `link`, `navigate`, `documentOf`,
`shortcut`, `toolbar`), and:

| Prop | Meaning |
|---|---|
| `page` | Which threads a page shows. `path` (default): each address's own. `route`: every address of a route shares them, so `/projects/1` and `/projects/2` show the threads of `/projects/[id]`. A string: one set for the whole app. A function: `(url) => key`. |
| `auth` | `{ signIn(), signOut() }`, to sign in another way than the routes of `config.auth`. |
| `bind:comments` | The `VisualComments` object while it runs. |

`Toolbar` is a pill of dark glass, as in Figma and Vercel's toolbar, centred
at the bottom of the window: the app's own tools, then, while comments are
on, the comment button with its unread dot, who is here, and the viewer's
avatar or Sign in. It replaces the comments' own floating toolbar. Its
`position` is `bottom` (default), `top`, or `inline` to place it in the
app's own layout. With comments off it shows only the app's tools, and
nothing when there are none. `ToolbarButton` is a tool in the same style:
an icon as its content, a `label`, and `pressed` for one that is on or off.
Theme both with `--vc-island`, `--vc-island-ink`, `--vc-island-hover` and
`--vc-font`. An app with a toolbar of its own instead marks its button
`data-vc-toggle` and an empty element `data-vc-account`
([markup](MARKUP.md)).

Inside `Comments`, `useComments()` returns `{ enabled, current }`, both
reactive: whether comments are on, and the `VisualComments` object once it
has started, e.g. for `current.unreadCount` or `current.participants`.

## Their own sign-in

When the app's accounts are not the people who comment, say the app's
customers sign in with its own system and the team reviewing it with
id.convex.works, the comments sign people in themselves, with
[@cnvx/sign-in](https://git.convex.works/ConvexWorks/sign-in) (`pnpm add @cnvx/sign-in`):

```ts
export const comments = commentsFromEnv(env, { dev, signIn: true });
```

Its hook then goes first, before the app's sign-in, which never sees the
comments' requests: `sequence(comments.sveltekit(), appHandle)`. It answers
the sign-in routes at `VISUAL_COMMENTS_AUTH` and keeps its session in its own
cookie, `visual_comments_session`. Outside `vite dev` it needs a provider: a
confidential client with `<origin><VISUAL_COMMENTS_AUTH>/callback` as its
redirect and `<origin>/` for sign-out, in `VISUAL_COMMENTS_OIDC_ISSUER`,
`VISUAL_COMMENTS_OIDC_CLIENT_ID`, `VISUAL_COMMENTS_OIDC_CLIENT_SECRET`, and
`VISUAL_COMMENTS_SESSION_SECRET` (32 or more random characters). Under
`vite dev` without them, anyone on localhost signs in with any name, and the
sessions last across restarts: their key comes from the space's secret, or
`VISUAL_COMMENTS_SESSION_SECRET` when set. To open
the dev server from another machine, name its address there:
`signIn: { devHosts: ['100.64.0.2'] }`. Whoever reaches it there can sign in
as anyone.

## Out of production builds

The variables turn comments off, but their code is still in the build. The
Vite plugin leaves it out instead: comments are in `vite dev`, and in a build
only when it runs with `VISUAL_COMMENTS_BUILD=true` (a staging build, say).

```ts
// vite.config.ts
import { visualComments } from 'visual-comments/vite';

export default defineConfig({ plugins: [visualComments(), sveltekit()] });
```

The app's code stays as it is. In a build without them, `Comments` renders
only what it wraps, `Toolbar` only the app's own tools (or nothing), and
`commentsFromEnv` is always off: neither the comments' client nor the proxy
nor their sign-in is in it, on the server or in the browser, whatever
`VISUAL_COMMENTS_ENABLED` says when it runs (it warns when that is `true`).
`visualComments({ include })` decides otherwise.

## Before SvelteKit 3

Read the variables from `$env/dynamic/private` and `dev`
from `$app/environment`, and import `$lib/server/comments` instead of
`#lib/server/comments.js`. Any other server can use `commentsFromEnv` too:
`commentsFromEnv(process.env)` gives `handle(request, user)` and `client`.
