# Security: who is signed in

The comment server has no sign-in of its own. It trusts the site's server,
which proves itself with the space's secret and names the person in each
request ([PROTOCOL.md](PROTOCOL.md)). So the site decides who may see and write
comments, and its session (an HttpOnly cookie, with
[@convex-works/sign-in](https://git.convex.works/ConvexWorks/sign-in)) is the
only one: signing in or out of the site does the same for its comments. A
request without a person sees no threads and cannot write.

People are kept per space, so a site can only change how its own people
appear. Images are served through the site's server too, to its signed-in
people only.

## Space secrets

Whoever has a space's secret can read the space and write as anyone in it.

- Generate secrets of at least 32 characters: `openssl rand -base64 32`.
- Keep the spaces file in a secret store.
- Give each site its own space and secret.
- The secret stays on the site's server; it is never sent to browsers.

See [DEPLOYMENT.md](DEPLOYMENT.md#spaces) for the spaces file.
