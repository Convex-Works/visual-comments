# Proxy protocol

Each site's own server answers the browser's comment requests at
`/_comments/*` and passes them on to the comment server. The JavaScript proxy
does this for you; servers in other languages implement the contract below.

## `commentsProxy` (JavaScript)

```ts
import { commentsProxy } from 'visual-comments/server';

const comments = commentsProxy({
  server: 'https://comments.convex.works',
  space: 'my-team',
  secret: env.COMMENTS_SECRET            // the space's secret; never sent to browsers
});
```

- `path` (optional) is where the browser reaches the comments on the site.
  Default `/_comments`.
- `comments.sveltekit()` is a SvelteKit `handle` hook; put it after the
  sign-in's hook. It answers `/_comments/*` and takes the person from
  `event.locals.user`, or from `comments.sveltekit((event) => user)`.
- `comments.handle(request, user)` works on any server with the Fetch API. It
  answers `/_comments/*` and returns `undefined` for other requests.
- `user` is `{ sub, name, email?, picture? }`, or `null` when nobody is signed
  in.

The proxy uses only the Fetch API, so it runs in Node, Bun, Deno and Workers.
When the comment server cannot be reached it answers `502` with a JSON error.

## Wire contract (any language)

A server in another language does the same in a few lines:

- Forward `/_comments/<rest>` to `<server>/v1/spaces/<space>/<rest>`, keeping
  the method, query string and body, and the `Content-Type`, `Accept` and
  `Last-Event-ID` request headers. Do not follow redirects.
- Add `Authorization: Bearer <secret>`, the space's secret.
- Add the signed-in person as base64url-encoded JSON
  (`{ sub, name, email?, picture? }`) in the `Visual-Comments-User` header.
  Omit it when nobody is signed in; such a request sees no threads and cannot
  write.
- When the request has `Authorization: Bearer vca_…` (a
  [coding agent](CODING-AGENTS.md)), send that token in
  `Visual-Comments-Agent` instead of the person. A request names a person or
  an agent, never both.
- Pass back the status, the body (streamed: live updates use server-sent
  events) and the `Content-Type`, `Cache-Control`, `Content-Security-Policy`,
  `X-Content-Type-Options` and `X-Accel-Buffering` response headers.

Never send the space's secret to browsers.

## Comment server routes

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
