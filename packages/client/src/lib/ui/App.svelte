<!--
  Everything the comments draw over the page, in one shadow root: layers that
  catch clicks over frames in comment mode, pins and cards, the list of
  threads, the floating toolbar and the dialog that lets an agent join.
-->
<script lang="ts">
	import type { VisualComments } from '../visual-comments.svelte.js';
	import type { Surface } from '../core/surfaces.js';
	import { setComments } from './context.js';
	import Connect from './Connect.svelte';
	import Overlay from './Overlay.svelte';
	import Panel from './Panel.svelte';
	import Toolbar from './Toolbar.svelte';

	let { vc }: { vc: VisualComments } = $props();
	// svelte-ignore state_referenced_locally
	setComments(vc);

	// A thread deleted, here or elsewhere, is no longer open.
	$effect(() => {
		if (vc.openId !== undefined && !vc.loading && !vc.open) vc.openId = undefined;
	});

	/** Frames take pointer events themselves; in comment mode a layer over each catches them first. */
	const catchers = $derived(vc.active ? vc.surfaces.filter((surface) => surface.catches) : []);

	function wheel(surface: Surface) {
		return (node: HTMLElement) => {
			const onwheel = (event: WheelEvent) => vc.wheel(surface, event);
			node.addEventListener('wheel', onwheel, { passive: false });
			return () => node.removeEventListener('wheel', onwheel);
		};
	}

	const panel = $derived(vc.panelRect);
</script>

<div class="vc-ui pointer-events-none fixed inset-0 font-vc text-[13px] text-vc-ink">
	{#each catchers as surface (surface.id)}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			{@attach wheel(surface)}
			role="presentation"
			class={['pointer-events-auto absolute', vc.cursor ? 'cursor-none!' : 'vc-comment-cursor']}
			style:left="{surface.clip.left}px"
			style:top="{surface.clip.top}px"
			style:width="{Math.max(0, surface.clip.right - surface.clip.left)}px"
			style:height="{Math.max(0, surface.clip.bottom - surface.clip.top)}px"
			onpointermove={(event) => vc.move({ x: event.clientX, y: event.clientY, alt: event.altKey })}
			onpointerleave={() => vc.move(undefined)}
			onclick={(event) => vc.place(surface, event.clientX, event.clientY, event.altKey)}
		></div>
	{/each}

	<Overlay />

	{#if vc.active}
		<Panel
			class={panel ? 'absolute z-20' : 'absolute top-3 right-3 bottom-3 z-20 w-80'}
			style={panel ? `left:${panel.left}px;top:${panel.top}px;width:${panel.right - panel.left}px;height:${panel.bottom - panel.top}px` : ''}
			onselect={(thread) => vc.focus(thread)}
			onclose={() => vc.toggle(false)}
		/>
	{/if}

	{#if vc.showToolbar}
		<Toolbar />
	{/if}

	{#if vc.connecting}
		{#key vc.connecting}
			<Connect id={vc.connecting} />
		{/key}
	{/if}
</div>
