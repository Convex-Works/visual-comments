<!--
  A tool of the comments' toolbar, for the app's own tools beside the
  comment button: round, light on the toolbar's dark glass, and filled while
  `pressed`. Give it an icon as its content and a `label`.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	let { label, pressed, children, ...rest }: HTMLButtonAttributes & {
		/** What the tool does, for screen readers and as its tooltip. */
		label: string;
		/** For a tool that is on or off. */
		pressed?: boolean;
		children: Snippet;
	} = $props();
</script>

<button type="button" class="vc-toolbar-button" aria-label={label} title={label} aria-pressed={pressed} {...rest}>
	{@render children()}
</button>

<style>
	.vc-toolbar-button {
		position: relative;
		display: inline-flex;
		height: 2rem;
		min-width: 2rem;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		border: 0;
		border-radius: 9999px;
		padding: 0 0.5rem;
		background: transparent;
		color: inherit;
		font: inherit;
		cursor: pointer;
		outline: none;
	}
	.vc-toolbar-button:hover {
		background: var(--vc-island-hover, rgb(255 255 255 / 0.14));
	}
	.vc-toolbar-button[aria-pressed='true'] {
		background: var(--vc-island-ink, #fff);
		color: var(--vc-ink, #292524);
	}
	.vc-toolbar-button:focus-visible {
		box-shadow: 0 0 0 2px rgb(255 255 255 / 0.6);
	}
	.vc-toolbar-button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	/* Something is unread: a dot, as on the comments' own toolbar. */
	.vc-toolbar-button[data-vc-unread]::after {
		content: '';
		position: absolute;
		top: 0.25rem;
		right: 0.25rem;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 9999px;
		background: var(--vc-comment, #0d99ff);
	}
</style>
