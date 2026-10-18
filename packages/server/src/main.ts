import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { serve } from './http.ts';
import { Spaces } from './spaces.ts';
import { CommentStore } from './store.ts';

const env = process.env;
const port = Number(env.PORT ?? 4400);
const widgetDir = env.WIDGET_DIR ?? fileURLToPath(new URL('../../client/dist-widget/', import.meta.url));

const store = new CommentStore(env.DATABASE ?? 'data/comments.sqlite');
const spaces = Spaces.load(env.SPACES ?? 'spaces.json');
const server = serve(createApp({ store, spaces, widgetDir }), port);
console.log(`visual-comments on http://localhost:${port}`);

// Closing the database checkpoints the WAL into the database file.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		server.close();
		store.close();
		process.exit(0);
	});
}
process.once('exit', () => store.close());
