# visual-comments

Comments pinned to the elements of any web page or app, like a design tool's
comments or Vercel's preview comments. People press **C**, click the element
they mean, and start a thread pinned to it. One self-hosted comment server
holds the threads of many sites; each site signs its own people in and passes
their comment requests on through its own server.

This package is the browser library (Svelte 5), the server-side proxy, and the
script-tag build. The comment server and full documentation live in the
[repository](https://github.com/Convex-Works/visual-comments).

```sh
npm install visual-comments
```

## Proxy the comment requests

The site's server passes `/_comments/*` on to the comment server with the
space's secret and the signed-in person:

```ts
// src/hooks.server.ts
import { sequence } from '@sveltejs/kit/hooks';
import { commentsProxy } from 'visual-comments/server';

const comments = commentsProxy({
	server: 'https://comments.example.com',
	space: 'my-team',
	secret: env.COMMENTS_SECRET // the space's secret; never sent to browsers
});

// After the site's sign-in hook, which sets `event.locals.user`.
export const handle = sequence(signIn, comments.sveltekit());
```

Other servers call `comments.handle(request, user)`. See the
[proxy protocol](https://github.com/Convex-Works/visual-comments/blob/main/docs/PROTOCOL.md).

## Add comments to the page

```ts
import { createVisualComments } from 'visual-comments';

const comments = createVisualComments({
	endpoint: '/_comments', // the default
	auth: '/auth',
	show: (thread) => canvas.zoomTo(thread.surface) // return true when handled
});
```

The library compiles with the host's Svelte (a peer dependency). Its options
are in the [library reference](https://github.com/Convex-Works/visual-comments/blob/main/docs/LIBRARY.md).
Pages without a bundler can use the script build instead, served by the
comment server at `/v1/visual-comments.js` and also shipped here as
`visual-comments/widget.js`; see the
[markup reference](https://github.com/Convex-Works/visual-comments/blob/main/docs/MARKUP.md).

## License

MIT
