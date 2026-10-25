import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { visualComments } from 'visual-comments/vite';

export default defineConfig({
	// The comments in `vite dev`, and in a build only with VISUAL_COMMENTS_BUILD=true.
	plugins: [visualComments(), sveltekit({ adapter: adapter() })],
	server: { port: 5173 }
});
