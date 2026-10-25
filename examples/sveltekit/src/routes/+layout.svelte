<script lang="ts">
	import { Comments, Toolbar, ToolbarButton } from 'visual-comments/sveltekit';

	let { data, children } = $props();
	let outlines = $state(false);
</script>

<!-- Off (data.comments is null), this renders only the pages and the app's own tool. -->
<Comments config={data.comments} page="route">
	<nav>
		<a href="/">Home</a>
		<a href="/projects/1">Project 1</a>
		<a href="/projects/2">Project 2</a>
	</nav>
	<main class:outlines>
		{@render children()}
	</main>
	<Toolbar>
		<ToolbarButton label="Outlines" pressed={outlines} onclick={() => (outlines = !outlines)}>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
				<rect x="4" y="4" width="16" height="16" rx="2" stroke-dasharray="3 2" />
			</svg>
		</ToolbarButton>
	</Toolbar>
</Comments>

<style>
	:global(body) {
		margin: 0;
		font-family: ui-sans-serif, system-ui, sans-serif;
		color: #292524;
	}
	nav {
		display: flex;
		gap: 1rem;
		padding: 1rem 2rem;
		border-bottom: 1px solid #e7e5e4;
	}
	main {
		max-width: 40rem;
		padding: 2rem;
	}
	.outlines :global(*) {
		outline: 1px dashed #0d99ff;
	}
</style>
