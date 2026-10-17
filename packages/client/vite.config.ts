import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// The script-tag build: one file with Svelte inside, styles added to shadow roots at run time.
export default defineConfig({
	plugins: [svelte({ compilerOptions: { css: 'injected' } })],
	build: {
		outDir: 'dist-widget',
		emptyOutDir: true,
		sourcemap: true,
		target: 'es2022',
		lib: {
			entry: 'src/widget.ts',
			formats: ['iife'],
			name: 'VisualCommentsWidget',
			fileName: () => 'visual-comments.js'
		}
	}
});
