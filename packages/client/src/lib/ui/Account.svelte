<svelte:options css="injected" />

<!--
  The account button: the viewer's avatar with a menu to sign out, or Sign in.
  It sits in the floating toolbar, or in a host's own toolbar where the host
  puts a `data-vc-account` element; there it takes the host's text colour.
-->
<script lang="ts">
	import type { VisualComments } from '../visual-comments.svelte.js';
	import Avatar from './Avatar.svelte';
	import { setComments } from './context.js';
	import Icon from './Icon.svelte';
	import Menu from './Menu.svelte';
	import MenuItem from './MenuItem.svelte';

	let { vc, slot = false }: { vc: VisualComments; slot?: boolean } = $props();
	// svelte-ignore state_referenced_locally
	if (slot) setComments(vc);

	const tool = $derived(slot ? 'vc-slot-tool' : 'vc-island-tool');
</script>

<span class={['vc-ui inline-flex', slot && 'vc-slot']}>
	{#if vc.viewer}
		<Menu label={`Account: ${vc.viewer.name}`} align="end" class="{tool} pr-2 pl-0.5">
			{#snippet trigger()}
				{#if vc.viewer}<Avatar user={vc.viewer} size={28} />{/if}
				<Icon name="chevron-down" size={14} />
			{/snippet}
			{#snippet children(close)}
				<div class="max-w-72 border-b border-vc-line px-3 py-2">
					<p class="truncate font-medium">{vc.viewer?.name}</p>
					{#if vc.viewer?.email}<p class="mt-0.5 truncate text-xs text-vc-muted">{vc.viewer.email}</p>{/if}
					{#if vc.store.spaceName}<p class="mt-0.5 truncate text-xs text-vc-muted">Comments in {vc.store.spaceName}</p>{/if}
				</div>
				<MenuItem onselect={() => { close(); vc.signOut(); }}>Sign out</MenuItem>
			{/snippet}
		</Menu>
	{:else}
		<button type="button" part="button" class="{tool} px-3.5 font-medium" disabled={vc.loading} onclick={() => vc.signIn()}>
			{vc.loading ? 'Connecting…' : 'Sign in'}
		</button>
	{/if}
</span>

<style>
	.vc-slot {
		font-family: inherit;
		font-size: inherit;
		color: inherit;
	}
	:global(.vc-slot-tool) {
		display: inline-flex;
		height: 2rem;
		align-items: center;
		gap: 0.375rem;
		border-radius: 9999px;
		color: inherit;
		outline: none;
	}
	:global(.vc-slot-tool:hover),
	:global(.vc-slot-tool[aria-expanded='true']) {
		background: color-mix(in srgb, currentColor 14%, transparent);
	}
	:global(.vc-slot-tool:focus-visible) {
		box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 50%, transparent);
	}
</style>
