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
- Pass back the status, the body (streamed: live updates use server-sent
  events) and the `Content-Type`, `Cache-Control`, `Content-Security-Policy`,
  `X-Content-Type-Options` and `X-Accel-Buffering` response headers.

Never send the space's secret to browsers.
