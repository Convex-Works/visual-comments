# Deployment

The comment server is a Node process with a SQLite database. One server holds
the threads of many sites, split into spaces.

Requires Node 24 or later and pnpm 12.4.1.

```sh
pnpm install
pnpm build                       # the client and its script bundle
cp packages/server/spaces.example.json packages/server/spaces.json   # then set real secrets
pnpm -F @visual-comments/server start
```

`pnpm -F` runs the server in `packages/server`, so relative paths in the
variables below resolve from there.

The server also serves the widget script at `<server>/v1/visual-comments.js`.

## Environment

| Variable | Meaning |
|---|---|
| `PORT` | Default 4400. |
| `DATABASE` | SQLite file. Default `data/comments.sqlite`. Its folder is created if missing. |
| `SPACES` | The spaces, as JSON or a path to a JSON file. Default `spaces.json`. |
| `WIDGET_DIR` | Folder of the built script served at `/v1/`. Default `packages/client/dist-widget`. |

## Docker

The `Dockerfile` builds an image of the server. Mount the database's folder
at `/data` and the spaces at `/config/spaces.json`. The image sets
`PORT=4400`, `DATABASE=/data/comments.sqlite` and
`SPACES=/config/spaces.json`, and exposes port 4400.

Run one instance: the database is a file, and presence and agents' join
requests are kept in memory.

## Spaces

A space holds one site's threads. Spaces are configuration
([example](../packages/server/spaces.example.json)): an object keyed by space
id (lowercase letters, digits and dashes), each with a `name` (defaults to the
id) and a `secret` of at least 32 characters (`openssl rand -base64 32`). The
server refuses to start on an invalid spaces file, including the example's
placeholder secrets. `"agents": false` keeps [coding agents](CODING-AGENTS.md)
out of a space: joining and agent tokens then answer 403.

```json
{
  "my-team": { "name": "Team prototype", "secret": "<openssl rand -base64 32>" }
}
```

Keep the file in a secret store: whoever has a space's secret can read the
space and write as anyone in it. Give each site its own space and secret. See
[SECURITY.md](SECURITY.md).

Thread numbers (#12) count per space and are never reused.
