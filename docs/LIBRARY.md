# Svelte library

For an app that needs more than markup, such as zooming its canvas to a
thread, use the `visual-comments` package directly:

```ts
import { createVisualComments } from 'visual-comments';

const comments = createVisualComments({
	endpoint: '/_comments',                   // the default
	auth: '/auth',                            // or { signIn() {…}, signOut() {…} }
	page: 'prototype',                        // or (url) => key
	show: (thread) => canvas.zoomTo(thread.surface),   // return true when handled
	navigate: (url) => router.push(url),      // a thread on another page; default: load it anew
	describe: (surface) => ({ title: frames.get(surface)?.title, order: frames.index(surface) }),
	context: (surface) => ({ release: APP_VERSION })
});

comments.toggle();          // comment mode
comments.active;            // state, reactive in Svelte
comments.subscribe((c) => render(c.active, c.unreadCount));   // elsewhere
comments.configure({ show });                                  // change options later
comments.relayout();        // after moving surfaces in a way the page cannot see
comments.setPresence({ page, surface });   // where this person is, for the others
comments.participants;      // everyone here now: people and agents, what they do
```

## Options

| Option | Meaning |
|---|---|
| `endpoint` | Where the site's server answers comment requests. Default `/_comments`. |
| `auth` | The sign-in routes' base path (default `/auth`), or an object with `signIn()` and `signOut()`. |
| `viewer` | Who is signed in, when the page already knows it (`null`: nobody), so the account shows before the server answers. Default: ask the server. |
| `page` | The page key, or a function from the URL to a key. Default: the address's origin and path. A fixed string makes every page share threads. |
| `show(thread)` | Called to bring a thread into view; return `true` when handled. Otherwise threads on other pages open by navigating to them. |
| `navigate(url, thread)` | Goes to a thread on another page when `show` did not handle it. Default `location.assign`; an app with its own router navigates in it, and the thread opens once its page is there. |
| `link(thread)` | The address that opens a thread. Default: where it was placed, with `#vc=<id>`. |
| `describe(surface)` | A surface's `title` and `order` in the thread list, for surfaces not on screen. |
| `context(surface)` | Extra data saved with threads placed on the surface, besides the viewport size and `data-vc-context`. |
| `documentOf(surface, frame)` | A frame surface's document, when the default (any same-origin frame once loaded) is not right. |
| `shortcut` | The key for comment mode. Default `c`; `false` for none. |
| `toolbar` | Show the floating toolbar. Default: unless the page has a `data-vc-toggle` button. |

`comments.unreadCount` counts unread threads. `subscribe` returns a function
that stops listening.

## Notes

- In Svelte, the fields are reactive state. Outside Svelte, use `subscribe`.
- The library compiles with the host's Svelte (a peer dependency, `^5.57.1`), so
  it shares its runtime.
- Everything renders in a shadow root, so the page's styles and the comments'
  never mix. Theme it with `--vc-*` properties ([THEMING.md](THEMING.md)).
- Markup attributes from [MARKUP.md](MARKUP.md) work with the library too.
- SvelteKit apps can use `visual-comments/sveltekit` instead ([SVELTEKIT.md](SVELTEKIT.md)).
- The script build exposes the same function as `VisualComments.create(options)`
  for pages that use `data-manual`.
