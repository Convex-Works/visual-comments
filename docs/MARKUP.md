# Markup reference

Sites that use the script tag configure visual-comments with attributes: on
the `<script>` itself, and `data-vc-*` attributes on the page.

```html
<script src="https://comments.convex.works/v1/visual-comments.js" defer></script>
```

## Script tag attributes

| Attribute | Meaning |
|---|---|
| `data-endpoint` | Where the site's server answers comment requests. Default `/_comments`. |
| `data-auth` | Where the site's sign-in routes are: `<auth>/login?returnTo=…` and a POST to `<auth>/logout`. Default `/auth`. |
| `data-page` | One page key for every address, when all pages share their threads. Default: the address's origin and path. |
| `data-toolbar="false"` | No floating toolbar; the site has its own button. |
| `data-shortcut` | Another key for comment mode, or `""` for none. |
| `data-manual` | Do not start; the page calls `VisualComments.create({...})` with the [library's options](LIBRARY.md#options). |

## Surfaces and page attributes

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
| `data-vc-interactive` | Treats an element as a control, like a button, when choosing what a pin attaches to. |
| `data-vc-toggle` | A button of the page that turns comment mode on and off. It gets `aria-pressed` and, while something is unread, `data-vc-unread`. The floating toolbar then hides. |
| `data-vc-account` | An empty element where the account button goes (avatar menu, or Sign in). It takes the element's text colour. |
| `data-vc-panel` | An empty box where the list of threads goes while comment mode is on, e.g. a column the page makes room for. Default: along the right edge. |

For styling, see [THEMING.md](THEMING.md). For apps that need more than
markup, see [LIBRARY.md](LIBRARY.md).
