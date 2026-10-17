# visual-comments

Comments pinned to the elements of a web page, like a design tool's comments
or Vercel's preview comments. One server holds the comments of many sites:
a prototype viewer such as paraframe, a deployed web app built with any
framework, and later a browser extension for any page.

People press **C** (or the speech-bubble button) to enter comment mode, then
click what they mean. The pin attaches to the element under the pointer, and
follows it as the page scrolls, zooms or changes. Threads have replies,
images, resolve and unread state, and update live.

```
packages/client   the browser part: a Svelte 5 library, and one script for any site
packages/server   the server: sign-in, spaces, threads, images and live updates
examples          a plain page and a zoomable canvas of frames, for development
```

## Add comments to a site

One script tag. The server is where the script comes from:

```html
<script src="https://comments.convex.works/v1/visual-comments.js" data-space="my-team" defer></script>
```

| Attribute | Meaning |
|---|---|
| `data-space` | The space whose threads the site shows. Required. |
| `data-page` | One page key for every address, when all pages share their threads. Default: the address's origin and path. |
| `data-toolbar="false"` | No floating toolbar; the site has its own button. |
| `data-shortcut` | Another key for comment mode, or `""` for none. |
| `data-server` | Another server than the script's. |

The site must be one of the space's origins (see [Spaces](#spaces)).

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
	server: 'https://comments.convex.works',
	space: 'my-team',
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
| `PUBLIC_URL` | Where the server is reached, e.g. `https://comments.convex.works`. The identity provider redirects to `<PUBLIC_URL>/auth/callback`. |
| `PORT` | Default 4400. |
| `DATABASE` | SQLite file. Default `data/comments.sqlite`. |
| `SPACES` | The spaces, as JSON or a path to a JSON file. Default `spaces.json`. |
| `OIDC_ISSUER` | Default `https://id.convex.works`. |
| `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | A confidential client with the code flow and S256 PKCE, and the callback above as redirect URL. |
| `DEV_LOGIN=1` | Sign in with any name, without an identity provider. Only on localhost. |

The `Dockerfile` builds an image of the server. Mount the database's folder
at `/data` and the spaces at `/config/spaces.json`. Run one instance: the
database is a file.

### Spaces

A space holds one team's threads, for the sites it lists. Spaces are
configuration ([example](packages/server/spaces.example.json)):

- `origins`: the sites that can show the space. Exact origins,
  `https://*.example.com` for any subdomain, `http://localhost:*` for any port.
- `members`: who can sign in. `*@example.com`, an exact address, `group:name`
  for a group of the identity provider, or `*` for anyone it signs in. An
  address the provider has not verified does not count.

Thread numbers (#12) count per space and are never reused.

### Sign-in

The server signs people in on its own origin, so it does not depend on
third-party cookies. The site opens `/auth/login` in a popup; after the
identity provider signs the person in, the server checks that they are a
member of the space and gives the site a token for that space. The token goes
by `postMessage` to the opener, at the site's origin only.
When the popup lost its opener, or popups are blocked, the token returns in
the fragment of the site's address instead. The site keeps the token in its
own storage and sends it as a bearer token. A token lasts 30 days after its last use,
works for one space only, and signing out ends it on the server.

Images are served at addresses with a random key, so they show in `<img>` on
any site; whoever has the address can see the image.

## Development

```sh
pnpm install
pnpm dev     # builds the client on change; the server on :4400 with development sign-in; the examples on :4401
pnpm test    # the server's API, storage and sign-in
pnpm check
```

The examples are served from another origin than the server, as real sites
are. `spaces.dev.json` admits any localhost site.
