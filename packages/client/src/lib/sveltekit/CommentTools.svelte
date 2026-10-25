<!--
  The comments' part of the toolbar, while they are on: the comment button and the account (who
  is here, and the viewer's avatar or Sign in), after a divider when the app's tools come first.
  Left out of builds without the comments (visual-comments/vite).
-->
<script lang="ts">
	import { page } from '$app/state';
	import { useComments } from './context.js';
	import ToolbarButton from './ToolbarButton.svelte';

	let { divider = false }: { divider?: boolean } = $props();

	const comments = useComments();
	const shortcut = $derived(comments?.current?.options.shortcut ?? 'c');
	const viewer = $derived(comments?.viewer);
	const initial = $derived(Array.from(viewer?.name.trim() || '?')[0].toLocaleUpperCase());
	const signIn = $derived(`${comments?.auth.replace(/\/$/, '')}/login?${new URLSearchParams({ returnTo: `${page.url.pathname}${page.url.search}` })}`);
</script>

{#if comments?.enabled}
	{#if divider}<span class="vc-toolbar-divider" aria-hidden="true"></span>{/if}
	<!-- The comments find this button by `data-vc-toggle`: clicks turn comment mode on and off, and they set `aria-pressed` and `data-vc-unread`. -->
	<ToolbarButton
		data-vc-toggle
		label={shortcut === false ? 'Comments' : `Comments (${shortcut.toUpperCase()})`}
		disabled={!comments.current}
	>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M12 3.5a8.5 8.5 0 1 1 0 17H3.5V12A8.5 8.5 0 0 1 12 3.5z" />
		</svg>
	</ToolbarButton>
	<!-- The comments put the account button here once they have started; until then, it shows who the server said is signed in. -->
	<span class="vc-toolbar-account" data-vc-account>
		{#if !comments.current && viewer}
			<span class="vc-toolbar-tool vc-toolbar-me" title={viewer.name}>
				<span class="vc-toolbar-avatar" aria-hidden="true">
					{#if viewer.picture}<img src={viewer.picture} alt="" referrerpolicy="no-referrer" />{:else}{initial}{/if}
				</span>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="m6 9 6 6 6-6" />
				</svg>
			</span>
		{:else if !comments.current && viewer === null}
			<a class="vc-toolbar-tool vc-toolbar-sign-in" href={signIn}>Sign in</a>
		{/if}
	</span>
{/if}

<style>
	.vc-toolbar-divider {
		width: 1px;
		height: 1.25rem;
		margin: 0 0.25rem;
		background: currentColor;
		opacity: 0.25;
	}
	/* The account draws in its own shadow root and takes the toolbar's text colour. */
	.vc-toolbar-account {
		display: inline-flex;
	}
	/* Until then, the same sizes as the account button. */
	.vc-toolbar-tool {
		display: inline-flex;
		height: 2rem;
		align-items: center;
		gap: 0.375rem;
		border-radius: 9999px;
		color: inherit;
		text-decoration: none;
	}
	.vc-toolbar-me {
		padding: 0 0.5rem 0 0.125rem;
	}
	.vc-toolbar-sign-in {
		padding: 0 0.875rem;
		font-weight: 500;
	}
	.vc-toolbar-sign-in:hover {
		background: color-mix(in srgb, currentColor 14%, transparent);
	}
	.vc-toolbar-avatar {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		overflow: hidden;
		border-radius: 9999px;
		background: var(--vc-avatar, #009aaa);
		color: #fff;
		font-size: 14px;
		line-height: 1;
	}
	.vc-toolbar-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
