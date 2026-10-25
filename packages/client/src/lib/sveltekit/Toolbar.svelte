<!--
  A toolbar in the style of Figma's and Vercel's: a pill of dark glass,
  centred at the bottom of the window (or the top, or wherever the app puts it
  with `position="inline"`). The app's own tools go first, as its content,
  e.g. `ToolbarButton`s; then, while comments are on, the comment button and
  the account (who is here, and the viewer's avatar or Sign in). It replaces
  the comments' own floating toolbar. With comments off and no tools of its
  own, it is not shown.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import CommentTools from './CommentTools.svelte';
	import { useComments } from './context.js';

	let { position = 'bottom', label = 'Toolbar', class: className, children }: {
		/** `bottom` or `top` of the window, centred; `inline` where the app places it. Default `bottom`. */
		position?: 'bottom' | 'top' | 'inline';
		/** The toolbar's name for screen readers. */
		label?: string;
		class?: string;
		/** The app's own tools. */
		children?: Snippet;
	} = $props();

	const comments = useComments();
</script>

{#if comments?.enabled || children}
	<!-- Never takes comments itself, even over a surface. -->
	<div role="toolbar" aria-label={label} data-vc-ignore class={['vc-toolbar', position, className]}>
		{@render children?.()}
		<CommentTools divider={Boolean(children)} />
	</div>
{/if}

<style>
	.vc-toolbar {
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		border-radius: 9999px;
		padding: 0.25rem;
		background: var(--vc-island, rgb(50 50 50 / 0.72));
		color: var(--vc-island-ink, #fff);
		font: 13px var(--vc-font, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif);
		box-shadow: 0 2px 10px rgb(0 0 0 / 0.2);
		backdrop-filter: blur(5px);
		-webkit-backdrop-filter: blur(5px);
	}
	.vc-toolbar.bottom,
	.vc-toolbar.top {
		position: fixed;
		left: 50%;
		translate: -50% 0;
		/* Under the comments' own layer, so their cards and menus open over it. */
		z-index: 2147483000;
	}
	.vc-toolbar.bottom {
		bottom: 1rem;
	}
	.vc-toolbar.top {
		top: 1rem;
	}
</style>
