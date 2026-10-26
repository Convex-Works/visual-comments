# Theming

The UI renders in shadow roots, so page styles do not reach it. Theme it by
setting `--vc-*` custom properties on the page; they inherit into the shadow
roots. The defaults live in
[`packages/client/src/lib/ui/styles.css`](../packages/client/src/lib/ui/styles.css).

```css
:root {
  --vc-comment: #e8461e;
  --vc-font: 'Inter', sans-serif;
}
```

| Property | Default | Used for |
|---|---|---|
| `--vc-font` | `ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif` | All UI text (13px base). |
| `--vc-comment` | `#0d99ff` | Pins, comment-mode accents, primary buttons. |
| `--vc-comment-soft` | `#e5f4ff` | Soft comment-colour washes, e.g. the selected thread. |
| `--vc-avatar` | `#009aaa` | The signed-in person's own avatar. Other people get a colour derived from their id. |
| `--vc-ink` | `#292524` | Main text. |
| `--vc-muted` | `#78716c` | Secondary text and placeholders. |
| `--vc-line` | `#d6d3d1` | Borders. |
| `--vc-wash` | `#e7e5e4` | Hover and focus backgrounds. |
| `--vc-surface` | `#f5f5f4` | Panel and card backgrounds. |
| `--vc-accent` | `#57534e` | Neutral accent text. |
| `--vc-island` | `rgb(50 50 50 / 0.72)` | The floating toolbar's background. |
| `--vc-island-ink` | `#fff` | The floating toolbar's text and icons. |
| `--vc-island-hover` | `rgb(255 255 255 / 0.14)` | The floating toolbar's hover state. |

An element marked `data-vc-account` takes its text colour from the page, so the
account button matches a host toolbar.
