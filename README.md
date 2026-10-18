# visual-comments

Comments pinned to the elements of a web page, like a design tool's comments
or Vercel's preview comments. One server holds the comments of many sites:
a prototype viewer such as paraframe, or a deployed web app built with any
framework. Each site signs its people in, and its own server passes their
comment requests on to the comment server.

People press **C** (or the speech-bubble button) to enter comment mode, then
click what they mean. The pin attaches to the element under the pointer, and
follows it as the page scrolls, zooms or changes. Threads have replies,
images, resolve and unread state, and update live.

```
packages/client   the browser part (a Svelte 5 library, and one script for any site),
                  and the proxy for the site's server (visual-comments/server)
packages/server   the comment server: spaces, threads, images and live updates
examples          a site with its own server and sign-in: a plain page and a zoomable canvas of frames
```

## Add comments to a site

A site needs two things on its own server: a sign-in, and a route that passes
comment requests on to the comment server with the space's secret.
[@convex-works/sign-in](../sign-in) is the sign-in; any other works if it can
say who is signed in.

```ts
// SvelteKit: src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { createSignIn } from '@convex-works/sign-in/server';
import { commentsProxy } from 'visual-comments/server';

const signIn = createSignIn({ issuer, clientId, clientSecret, secret });
const comments = commentsProxy({
  server: 'https://comments.convex.works',
  space: 'my-team',
  secret: env.COMMENTS_SECRET            // the space's secret; never sent to browsers
});

export const handle = sequence(signIn.sveltekit(), comments.sveltekit());
```

`comments.sveltekit()` answers `/_comments/*` and takes the person from
`event.locals.user`. Any other server with the Fetch API calls
`comments.handle(request, user)`, which answers `/_comments/*` and returns
undefined for other requests. `user` is `{ sub, name, email?, picture? }`, or
null when nobody is signed in. A server in another language does the same in a
few lines: forward `/_comments/<rest>` to `<server>/v1/spaces/<space>/<rest>`
with `Authorization: Bearer <secret>`, and the person as base64url JSON in
`Visual-Comments-User`.

Then one script tag on the pages:

```html
<script src="https://comments.convex.works/v1/visual-comments.js" defer></script>
```

| Attribute | Meaning |
|---|---|
| `data-endpoint` | Where the site's server answers comment requests. Default `/_comments`. |
| `data-auth` | Where the site's sign-in routes are: `<auth>/login?returnTo=…` and a POST to `<auth>/logout`. Default `/auth`. |
| `data-page` | One page key for every address, when all pages share their threads. Default: the address's origin and path. |
| `data-toolbar="false"` | No floating toolbar; the site has its own button. |
| `data-shortcut` | Another key for comment mode, or `""` for none. |
| `data-manual` | Do not start; the page calls `VisualComments.create({...})`. |

### Declare surfaces in markup

Without declarations the whole page takes comments. A page that shows
other things, like a canvas of frames, says which parts take comments:

| Attribute | Meaning |
|---|---|
| `data-vc-surface="id"` | A part of the page that takes comments. When a page has any, only they do. Pins are kept in its own pixels, so they stay put when it is zoomed, panned or moved. |
| `data-vc-title="Inbox"` | The surface's name in the list and on threads. |
| `data-vc-frame` | On an `<iframe>` inside a surface: pins attach to elements of the frame's page. A surface that is itself an `<iframe>` does this too. The frame must be same-origin; otherwise pins stay where they are placed. |
| `data-vc-context='{"flow":"Sign-up"}'` | Saved with threads placed on the surface. |
| `data-vc-gestures="host"` | On a surface or an element around it: in comment mode the page still gets presses and drags there (to pan a canvas); only clicks start threads. |
| `data-vc-ignore` | Never takes comments: the page's own toolbars over a surface. |
| `data-vc-target="Prompt table"` | Names an element for pins, and gives it a stable selector. |
| `data-vc-toggle` | A button of the page that turns comment mode on and off. It gets `aria-pressed` and, while something is unread, `data-vc-unread`. The floating toolbar then hides. |
| `data-vc-account` | An empty element where the account button goes (avatar menu, or Sign in). It takes the element's text colour. |
| `data-vc-panel` | An empty box where the list of threads goes while comment mode is on, e.g. a column the page makes room for. Default: along the right edge. |

Theme the UI with `--vc-comment`, `--vc-avatar`, `--vc-font` and the other
`--vc-*` properties of `packages/client/src/lib/ui/styles.css`, set on the page.

### Or use the library

For an app that needs more than markup, such as zooming its canvas to a thread:

```ts
import { createVisualComments } from 'visual-comments';

const comments = createVisualComments({
	endpoint: '/_comments',                   // the default
	auth: '/auth',                            // or { signIn() {…}, signOut() {…} }
	page: 'prototype',                        // or (url) => key
	show: (thread) => canvas.zoomTo(thread.surface),   // return true when handled
	describe: (surface) => ({ title: frames.get(surface)?.title, order: frames.index(surface) }),
	context: (surface) => ({ release: APP_VERSION })
});

comments.toggle();          // comment mode
comments.active;            // state, reactive in Svelte
comments.subscribe((c) => render(c.active, c.unreadCount));   // elsewhere
comments.configure({ show });                                  // change options later
comments.relayout();        // after moving surfaces in a way the page cannot see
```

In Svelte, the fields are reactive state. The library compiles with the
host's Svelte, so it shares its runtime.

Everything renders in a shadow root, so the page's styles and the comments'
never mix.

## How placement works

A thread stores its page key, its surface, the pin's point in surface pixels
and, when it was placed on an element, that element: a short selector, its
label and text, and its box. To show the pin again, the selector finds the
element and the text confirms it is the same one. The pin keeps the same share
of the element's width and height, so it survives layout changes. When the
element is gone or out of view, the pin hides. Free pins (hold Alt, or
open space) stay at their point.

The client measures surfaces on the screen against their layout size to get
their scale and position. It measures again on any change of the page or a
frame, on scrolling and resizing, and during transitions.

## Server

```sh
pnpm install
pnpm build                       # the client and its script bundle
pnpm -F @visual-comments/server start
```

| Variable | Meaning |
|---|---|
| `PORT` | Default 4400. |
| `DATABASE` | SQLite file. Default `data/comments.sqlite`. |
| `SPACES` | The spaces, as JSON or a path to a JSON file. Default `spaces.json`. |

The `Dockerfile` builds an image of the server. Mount the database's folder
at `/data` and the spaces at `/config/spaces.json`. Run one instance: the
database is a file.

### Spaces

A space holds one site's threads. Spaces are configuration
([example](packages/server/spaces.example.json)): an id, a name and a secret
of at least 32 characters (`openssl rand -base64 32`). Keep the file in a
secret store: whoever has a space's secret can read the space and write as
anyone in it. Give each site its own space and secret.

Thread numbers (#12) count per space and are never reused.

### Who is signed in

The comment server has no sign-in of its own. It trusts the site's server,
which proves itself with the space's secret and names the person in each
request. So the site decides who may see and write comments, and its session
(an HttpOnly cookie, with [@convex-works/sign-in](../sign-in)) is the only
one: signing in or out of the site does the same for its comments. A request
without a person sees no threads and cannot write.

People are kept per space, so a site can only change how its own people
appear. Images are served through the site's server too, to its signed-in
people only.

## License

[MIT](LICENSE)

## Development

```sh
pnpm install
pnpm dev     # builds the client on change; the comment server on :4400; the examples site on :4401
pnpm test    # the server's API, storage and sign-in
pnpm check
```

The examples site (`examples/server.ts`) has its own server, as real sites
do: it signs people in with [@convex-works/sign-in](../sign-in), with any name
unless `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `SESSION_SECRET` are set,
and passes comment requests on to the `demo` space of `spaces.dev.json`.
It expects the sign-in repository next to this one.
