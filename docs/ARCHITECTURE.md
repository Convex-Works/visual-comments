# Architecture

visual-comments has three parts: a browser client, a proxy that runs on each
site's own server, and one comment server shared by many sites.

```
browser (widget or Svelte library)
   │  /_comments/*            (same origin, the site's session cookie)
   ▼
site's server ── commentsProxy ──►  comment server  /v1/spaces/<space>/*
   (signs people in)               (Bearer <space secret> + Visual-Comments-User)
```

The browser never talks to the comment server about threads directly; the
site's server passes each request on with the space's secret and the signed-in
person. See [PROTOCOL.md](PROTOCOL.md) for the wire contract and
[SECURITY.md](SECURITY.md) for the trust model.

## Repository layout

```
packages/client     the browser part (a Svelte 5 library, and one script for any site),
                    the proxy for the site's server (visual-comments/server),
                    the SvelteKit adapter (visual-comments/sveltekit, visual-comments/vite),
                    and the visual-comments command for coding agents
packages/server     the comment server: spaces, threads, images, presence and live updates
examples            a site with its own server and sign-in: a plain page and a zoomable canvas of frames
examples/sveltekit  a SvelteKit app: comments set up from environment variables, in a toolbar of its own
```

## Rendering

Everything renders in a shadow root, so the page's styles and the comments'
never mix. The UI's styles are compiled into a string and added to those
shadow roots; the page themes them through inherited `--vc-*` custom
properties ([THEMING.md](THEMING.md)).

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

Surfaces and frames are declared in markup ([MARKUP.md](MARKUP.md)) or
described through the library ([LIBRARY.md](LIBRARY.md)).
