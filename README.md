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
                  the proxy for the site's server (visual-comments/server),
                  and the visual-comments command for coding agents
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
`Visual-Comments-User`. When the request has `Authorization: Bearer vca_…`
(an [agent](#agents)), send that token in `Visual-Comments-Agent` instead of
the person.

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
comments.setPresence({ page, surface });   // where this person is, for the others
comments.participants;     // everyone here now: people and agents, what they do
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

## Agents

Coding agents (Claude Code, omp, …) take part in a space like people do:
they get every new comment, decide themselves whether to act, reply under
their own name, and show what they are doing.

A person in a browser is the site's cookie, for the whole site. An agent is a
member of one space, added by a person: its token (`vca_…`) only works on the
site's comments route, so it is useless for the site's own routes. An agent
can do what people do with comments, and nothing else. The server keeps only
a hash of the token. Anyone in the space can remove an agent, which ends its
token at once; a token unused for 30 days ends too. Its comments show a badge
and who added it.

### Joining

```sh
npx visual-comments connect http://localhost:5173 --name Claude
```

The command prints an address, `<site>/#vc-connect=<id>`, and a code, and
opens the address in the browser. There the page shows *Claude wants to join
<space> as an agent* with the same code, and Allow or Deny; signed-out
people sign in first. On Allow the command saves the token and ends. The
request lasts 10 minutes. The agent starts with every existing thread read,
so only new comments reach it.

The account menu lists the space's agents, with who added each, and removes
them.

### The command

`visual-comments` comes with the package (Node 24 or later). It talks only to
the site, at `<site>/_comments`. Output is JSON on stdout; messages go to
stderr.

| Command | Does |
|---|---|
| `connect <site> [--name N] [--path /_comments]` | Asks to join, waits for Allow, saves the token. Default name `Agent`. Already connected: prints the agent and ends. |
| `next` | Waits, as long as it takes, for threads with something new; prints `{ site, threads, participants }` and ends. The threads are then read for the agent. Images are downloaded to `<tmpdir>/visual-comments/<host>/`, and each gets a `path`. Network errors and server errors are retried. |
| `reply <thread> [--body T]` | Replies in the thread, with `--body` or stdin. Prints `{ thread: { id, url, comment } }`. |
| `presence <viewing\|working\|gone> [--key K] [--thread N] [--surface S] [--page P] [--note T]` | Says what the agent is doing. |
| `agents` | Lists the space's agents. |
| `disconnect` | Removes the agent from the space and forgets the token. |

Tokens are kept in `${XDG_CONFIG_HOME:-~/.config}/visual-comments/agents.json`
(readable only by you), one per site. With more than one site saved, choose
with `--site <site>` or `VISUAL_COMMENTS_SITE`. Exit codes: 0 done, 1 error,
2 not connected or the token was rejected (run `connect` again).

### Presence

Everyone in the space shows as avatars by the account button, live. Each
browser tab is a participant: `viewing`, or `typing` while its person writes
in a thread. Agents say `working` with a note, e.g. *Tightening the table*;
the open thread then shows *Claude is working: Tightening the table*, and its
pin pulses. Pages can show more with `participants`: paraframe makes frames
glow.

An agent has one participant per `--key`, so it can work on several things
at once: use the thread number as the key, and `presence gone --key <n>` when
done. Each update states the whole presence; options left out are cleared.
An agent counts as here, viewing, while `next` waits or it made a request in
the last minute; when it leaves, its participants go.

### The inbox

A thread is in an agent's inbox when someone else wrote in it since the
agent last read it. `next` returns every such thread, whole, and marks them
read. While the author of the latest comment is still typing in the thread,
the thread waits, at most 30 seconds. There is no @mention: the agent reads
everything and decides.

### Turning agents off

Set `"agents": false` on a space in the spaces file. Joining and agent tokens
then answer 403.

### The agent loop

Put this in the app's `AGENTS.md` (or `CLAUDE.md`), adapted to it:

```md
## Comments

People comment on this app in the browser with visual-comments. You read the
comments and do what they ask.

1. Start the dev server in the background and note its address.
2. Once per site: `npx visual-comments connect <address> --name <your name>`.
   The person clicks Allow in the browser; the command ends when they do.
3. Run `npx visual-comments next` in the background, with no timeout. When it
   ends, run it again at once, then read every thread it printed (images: open
   each image's `path`). Decide whether someone asks for something; a comment
   may be a remark, or meant for someone else. Skip a thread when a participant
   is already `working` on it.
4. For each piece of work, start one worker. Never two at once on the same
   surface or the same source file. Before it starts:
   `npx visual-comments presence working --key <thread> --thread <thread> --surface <surface> --note "<what>"`
5. The worker makes the change, then
   `npx visual-comments reply <thread> --body "<what changed>"`, then
   `npx visual-comments presence gone --key <thread>`.
   A question gets an answer by `reply`, without a worker.
6. If a command exits with 2, the token is gone: run `connect` again.

The main session is the dispatcher: Claude Code subagents cannot start
subagents. Workers need edits approved beforehand: a permission prompt shows
in the terminal, not in the browser where the person is.
```

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
database is a file, and presence and agents' join requests are kept in
memory.

### Spaces

A space holds one site's threads. Spaces are configuration
([example](packages/server/spaces.example.json)): an id, a name, a secret of
at least 32 characters (`openssl rand -base64 32`) and, to keep
[agents](#agents) out, `"agents": false`. Keep the file in a secret store:
whoever has a space's secret can read the space and write as anyone in it.
Give each site its own space and secret.

Thread numbers (#12) count per space and are never reused.

### Who is signed in

The comment server has no sign-in of its own. It trusts the site's server,
which proves itself with the space's secret and names the person in each
request. So the site decides who may see and write comments, and its session
(an HttpOnly cookie, with [@convex-works/sign-in](../sign-in)) is the only
one: signing in or out of the site does the same for its comments. A request
without a person (or an agent) sees no threads and cannot write.

Agents are the exception: a person adds them to the space, and the comment
server keeps them. The site's server passes an agent's token on in
`Visual-Comments-Agent` instead of the person, and the comment server checks
it against the space's agents. Wherever an agent is an author, it is
`{ sub: 'agent:<id>', name, agent: { addedBy } }`. A request names a person
or an agent, never both.

People are kept per space, so a site can only change how its own people
appear. Images are served through the site's server too, to its signed-in
people and its agents only.

### Routes

Under `<server>/v1/spaces/<space>`, all with the space's secret; browsers and
agents reach them as `<site>/_comments/…`. *Person* and *agent* say who the
request must name; *either* takes both.

| Route | Who | Does |
|---|---|---|
| `GET /` | anyone | The space, the viewer and, for a viewer, the threads. |
| `GET /events` | either | Server-sent events: `hello` (the connection's id), `presence` (`{ participants }`), `change` (refetch). |
| `POST /presence` | either | Says what the viewer is doing (`PresenceUpdate`): a person names a connection, an agent a key. |
| `POST /threads` | either | Starts a thread. |
| `PATCH /threads/:n` | either | `{ resolved }`. |
| `DELETE /threads/:n` | either | Deletes a thread. |
| `POST /threads/:n/comments` | either | Replies: `{ body, images? }`. |
| `POST /threads/:n/read` | either | `{ read }`. |
| `PATCH /comments/:id`, `DELETE /comments/:id` | either | Edits or deletes a comment. |
| `POST /images`, `GET /images/:id/:key` | either | Uploads an image (the raw bytes, `?width=&height=`); serves one. |
| `POST /agents/requests` | anyone | An agent asks to join: `{ name }` → `{ id, code, secret, expiresAt }`. |
| `POST /agents/requests/:id/token` | anyone | The agent waits for its token: `{ secret }`; up to 50 s, then 202 `{ pending: true }`. |
| `GET /agents/requests/:id` | person | The request, to approve. |
| `POST /agents/requests/:id/approve`, `DELETE /agents/requests/:id` | person | Allows or denies it. |
| `GET /agents` | either | The space's agents. |
| `DELETE /agents/:id` | either | Removes an agent: any person, or the agent itself. |
| `GET /agent/next?wait=50` | agent | The inbox: waits up to `wait` seconds for threads with something new. |

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
