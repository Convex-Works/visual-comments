# Coding agents

Coding agents (Claude Code, omp, …) take part in a space like people do:
they get every new comment, decide themselves whether to act, reply under
their own name, and show what they are doing.

A person in a browser is the site's cookie, for the whole site. An agent is a
member of one space, added by a person: its token (`vca_…`) only works on the
site's comments route, so it is useless for the site's own routes. An agent
can do what people do with comments, and nothing else. The server keeps only
a hash of the token. Anyone in the space can remove an agent, which ends its
token at once; a token unused for 30 days ends too. Its comments show a badge
and who added it.

## Joining

```sh
npx visual-comments connect http://localhost:5173 --name Claude
```

The command prints an address, `<site>/#vc-connect=<id>`, and a code, and
opens the address in the browser. There the page shows *Claude wants to join
<space> as an agent* with the same code, and Allow or Deny; signed-out
people sign in first. On Allow the command saves the token and ends. The
request lasts 10 minutes. The agent starts with every existing thread read,
so only new comments reach it.

The account menu lists the space's agents, with who added each, and removes
them.

## The command

`visual-comments` comes with the package (Node 24 or later). It talks only to
the site, at `<site>/_comments`. Output is JSON on stdout; messages go to
stderr.

| Command | Does |
|---|---|
| `connect <site> [--name N] [--path /_comments]` | Asks to join, waits for Allow, saves the token. Default name `Agent`. Already connected: prints the agent and ends. |
| `next` | Waits, as long as it takes, for threads with something new; prints `{ site, threads, participants }` and ends. The threads are then read for the agent. Images are downloaded to `<tmpdir>/visual-comments/<host>/`, and each gets a `path`. Network errors and server errors are retried. |
| `reply <thread> [--body T]` | Replies in the thread, with `--body` or stdin. Prints `{ thread: { id, url, comment } }`. |
| `presence <viewing\|working\|gone> [--key K] [--thread N] [--surface S] [--page P] [--note T]` | Says what the agent is doing. |
| `agents` | Lists the space's agents. |
| `disconnect` | Removes the agent from the space and forgets the token. |

Tokens are kept in `${XDG_CONFIG_HOME:-~/.config}/visual-comments/agents.json`
(readable only by you), one per site. With more than one site saved, choose
with `--site <site>` or `VISUAL_COMMENTS_SITE`. Exit codes: 0 done, 1 error,
2 not connected or the token was rejected (run `connect` again).

## Presence

Everyone in the space shows as avatars by the account button, live. Each
browser tab is a participant: `viewing`, or `typing` while its person writes
in a thread. Agents say `working` with a note, e.g. *Tightening the table*;
the open thread then shows *Claude is working: Tightening the table*, and its
pin pulses. Pages can show more with `participants`: paraframe makes frames
glow.

An agent has one participant per `--key`, so it can work on several things
at once: use the thread number as the key, and `presence gone --key <n>` when
done. Each update states the whole presence; options left out are cleared.
An agent counts as here, viewing, while `next` waits or it made a request in
the last minute; when it leaves, its participants go.

## The inbox

A thread is in an agent's inbox when someone else wrote in it since the
agent last read it. `next` returns every such thread, whole, and marks them
read. While the author of the latest comment is still typing in the thread,
the thread waits, at most 30 seconds. There is no @mention: the agent reads
everything and decides.

## Turning agents off

Set `"agents": false` on a space in the spaces file. Joining and agent tokens
then answer 403.

## The agent loop

Put this in the app's `AGENTS.md` (or `CLAUDE.md`), adapted to it:

```md
## Comments

People comment on this app in the browser with visual-comments. You read the
comments and do what they ask.

1. Start the dev server in the background and note its address.
2. Once per site: `npx visual-comments connect <address> --name <your name>`.
   The person clicks Allow in the browser; the command ends when they do.
3. Run `npx visual-comments next` in the background, with no timeout. When it
   ends, run it again at once, then read every thread it printed (images: open
   each image's `path`). Decide whether someone asks for something; a comment
   may be a remark, or meant for someone else. Skip a thread when a participant
   is already `working` on it.
4. For each piece of work, start one worker. Never two at once on the same
   surface or the same source file. Before it starts:
   `npx visual-comments presence working --key <thread> --thread <thread> --surface <surface> --note "<what>"`
5. The worker makes the change, then
   `npx visual-comments reply <thread> --body "<what changed>"`, then
   `npx visual-comments presence gone --key <thread>`.
   A question gets an answer by `reply`, without a worker.
6. If a command exits with 2, the token is gone: run `connect` again.

The main session is the dispatcher: Claude Code subagents cannot start
subagents. Workers need edits approved beforehand: a permission prompt shows
in the terminal, not in the browser where the person is.
```
