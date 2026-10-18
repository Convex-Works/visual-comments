// The script-tag build: `<script src="https://comments.example/v1/visual-comments.js" defer>`.
// The site's server answers `/_comments` (`data-endpoint` for another path)
// and its sign-in is at `/auth` (`data-auth`). `data-page` gives every page
// the same threads; `data-toolbar="false"` hides the floating toolbar;
// `data-shortcut` changes the C key, or turns it off with "".
import { createVisualComments, VisualComments } from './lib/index.js';

declare global {
	interface Window {
		visualComments?: VisualComments;
		VisualComments?: { create: typeof createVisualComments };
	}
}

const script = document.currentScript as HTMLScriptElement | null;
window.VisualComments = { create: createVisualComments };

// `data-manual` leaves starting to the page, through `VisualComments.create`.
if (script && !('manual' in script.dataset) && !window.visualComments) {
	const { endpoint, auth, page, toolbar, shortcut } = script.dataset;
	const start = () => {
		window.visualComments = createVisualComments({
			endpoint: endpoint || undefined,
			auth: auth || undefined,
			page: page || undefined,
			toolbar: toolbar === undefined ? undefined : toolbar !== 'false',
			shortcut: shortcut === undefined ? undefined : shortcut || false
		});
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
	else start();
}
