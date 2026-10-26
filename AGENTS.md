# AGENTS.md

Notes for agents and maintainers working in this repository.

## Rules

- Node 24 or later, pnpm 12.4.1. Install with `pnpm install`.
- Run `pnpm test` and `pnpm check` before committing; both must pass.
- `pnpm build` builds the client library and the widget bundle
  (`packages/client/dist-widget/visual-comments.js`); the comment server
  serves that bundle, so build before starting it.
- The examples site links `@convex-works/sign-in` from `../../sign-in`
  (`examples/package.json`): it needs the
  [sign-in repository](https://git.convex.works/ConvexWorks/sign-in) checked
  out next to this one. So does `packages/client` (a dev dependency, for
  the comments' own sign-in in `visual-comments/server`).
- Default ports are 4400 (comment server) and 4401 (examples). `pnpm dev`
  starts both in parallel, so to use other ports start them separately with
  `PORT=… pnpm -F @visual-comments/server dev` and
  `PORT=… COMMENTS_SERVER=http://localhost:… pnpm -F @visual-comments/examples dev`.
  Stop any server you start.
- Without OIDC settings, the examples sign in with any name:
  `/auth/login?name=Maya%20Chen&returnTo=/`.
- Changing the UI defaults in `packages/client/src/lib/ui/styles.css` changes
  every host's look; hosts override them with `--vc-*` variables.
- Keep the README short and aimed at people adding comments to a site.
  Reference material goes in `docs/`.

## Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): parts, repository layout, rendering, and how pin placement works.
- [docs/PROTOCOL.md](docs/PROTOCOL.md): `commentsProxy` and the proxy wire contract for servers in any language.
- [docs/SECURITY.md](docs/SECURITY.md): who is signed in, the trust model, and space secrets.
- [docs/MARKUP.md](docs/MARKUP.md): script tag attributes and `data-vc-*` surface attributes.
- [docs/LIBRARY.md](docs/LIBRARY.md): the Svelte library, `createVisualComments` and its options.
- [docs/SVELTEKIT.md](docs/SVELTEKIT.md): `visual-comments/sveltekit`, its environment variables, own sign-in and Vite plugin.
- [docs/CODING-AGENTS.md](docs/CODING-AGENTS.md): how coding agents join a space, the `visual-comments` command, presence.
- [docs/THEMING.md](docs/THEMING.md): the `--vc-*` CSS variables and their defaults.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): server environment, Docker, and spaces.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): dev commands, ports, the examples site, and dev sign-in.
