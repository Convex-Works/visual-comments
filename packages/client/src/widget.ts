// The script-tag build: `<script src="https://comments.example/v1/visual-comments.js" data-space="team" defer>`.
// The server is where the script came from, unless `data-server` says otherwise.
// `data-page` gives every page the same threads; `data-toolbar="false"` hides
// the floating toolbar; `data-shortcut` changes the C key, or turns it off with "".
import { createVisualComments, VisualComments } from './lib/index.js';

declare global {
	interface Window {
		visualComments?: VisualComments;
		VisualComments?: { create: typeof createVisualComments };
	}
}

const script = document.currentScript as HTMLScriptElement | null;
window.VisualComments = { create: createVisualComments };

if (script?.dataset.space && !window.visualComments) {
	const { space, server, page, toolbar, shortcut } = script.dataset;
	const start = () => {
		window.visualComments = createVisualComments({
			server: server ?? new URL(script.src).origin,
			space,
			page: page || undefined,
			toolbar: toolbar === undefined ? undefined : toolbar !== 'false',
			shortcut: shortcut === undefined ? undefined : shortcut || false
		});
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
	else start();
}
