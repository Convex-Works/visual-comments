# Development

Requires Node 24 or later and pnpm 12.4.1.

```sh
pnpm install
pnpm dev     # builds the client on change; the comment server on :4400; the examples site on :4401
pnpm test    # the server's API, storage and sign-in
pnpm check
```

`pnpm build` builds the client library (`packages/client/dist`) and the widget
bundle (`packages/client/dist-widget/visual-comments.js`).

## Running the servers separately

`pnpm dev` starts both servers in parallel, so a single `PORT` would collide.
To pick ports, build first and start them separately:

```sh
pnpm build
PORT=6140 pnpm -F @visual-comments/server dev
PORT=6141 COMMENTS_SERVER=http://localhost:6140 pnpm -F @visual-comments/examples dev
```

The server's `dev` script uses `SPACES=spaces.dev.json` and
`DATABASE=data/dev.sqlite`.

## The examples site

The examples site (`examples/server.ts`) has its own server, as real sites
do: it signs people in with
[@cnvx/sign-in](https://git.convex.works/ConvexWorks/sign-in), with any
name unless `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` and `SESSION_SECRET` are set
(`OIDC_ISSUER` defaults to `https://id.convex.works`), and passes comment
requests on to the `demo` space of `packages/server/spaces.dev.json`.
`COMMENTS_SERVER` sets the comment server (default `http://localhost:4400`).

It expects the sign-in repository next to this one: `examples/package.json`
links `@cnvx/sign-in` from `../../sign-in`.

Without OIDC settings, sign in by visiting
`/auth/login?name=Maya%20Chen&returnTo=/`. Use different names to get several
authors.

Pages:

- `/index.html` — a plain page (a "Quarterly overview" dashboard and long content).
- `/canvas.html` — a zoomable canvas of same-origin iframe frames, with the
  page's own Comments toggle, account slot and thread panel.
- `/other.html` — a second page, whose threads are kept apart.
- `/frame.html` — the page shown inside the canvas frames.

## The SvelteKit example

`examples/sveltekit` is a SvelteKit app set up from environment variables
([SVELTEKIT.md](SVELTEKIT.md)), against the comment server of `pnpm dev`:

```sh
cp examples/sveltekit/.env.example examples/sveltekit/.env
pnpm -F @visual-comments/example-sveltekit dev     # on :5173
```
