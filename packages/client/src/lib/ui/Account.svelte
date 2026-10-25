<svelte:options css="injected" />

<!--
  The account button: the viewer's avatar with a menu to sign out and to see
  the space's agents, or Sign in; beside it, who else is here. It sits in the
  floating toolbar, or in a host's own toolbar where the host puts a
  `data-vc-account` element; there it takes the host's text colour.
-->
<script lang="ts">
	import type { VisualComments } from '../visual-comments.svelte.js';
	import type { Agent } from '../shared/types.js';
	import Avatar from './Avatar.svelte';
	import { setComments } from './context.js';
	import Icon from './Icon.svelte';
	import Menu from './Menu.svelte';
	import MenuItem from './MenuItem.svelte';
	import Presence from './Presence.svelte';

	let { vc, slot = false }: { vc: VisualComments; slot?: boolean } = $props();
	// svelte-ignore state_referenced_locally
	if (slot) setComments(vc);

	const tool = $derived(slot ? 'vc-slot-tool' : 'vc-island-tool');
	const signedIn = $derived(Boolean(vc.viewer));

	// Listed ahead, so the menu opens at its full size.
	$effect(() => {
		if (signedIn) void vc.store.loadAgents();
	});

	function remove(agent: Agent) {
		if (confirm(`Remove ${agent.name}? It will no longer see or write comments here.`)) void vc.store.removeAgent(agent.id);
	}
</script>

<span class={['vc-ui inline-flex items-center', slot && 'vc-slot']}>
	{#if vc.viewer}
		<Presence {vc} />
		<Menu label={`Account: ${vc.viewer.name}`} align="end" class="{tool} pr-2 pl-0.5" onopen={() => vc.store.loadAgents()}>
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
				{#if vc.store.agents}
					<div class="max-w-72 border-b border-vc-line py-1.5">
						<p class="px-3 pb-1 text-xs text-vc-muted">Agents</p>
						{#each vc.store.agents as agent (agent.id)}
							<div class="flex items-center gap-2 px-3 py-1">
								<Avatar user={{ sub: `agent:${agent.id}`, name: agent.name, agent: { addedBy: agent.addedBy } }} size={22} />
								<div class="min-w-0 flex-1">
									<p class="truncate">{agent.name}</p>
									<p class="truncate text-xs text-vc-muted">Added by {agent.addedBy.name}</p>
								</div>
								<button
									type="button"
									class="shrink-0 rounded-[2px] px-1.5 py-0.5 text-xs text-vc-muted outline-none hover:bg-vc-wash hover:text-vc-ink focus-visible:bg-vc-wash"
									aria-label="Remove {agent.name}"
									onclick={() => remove(agent)}
								>Remove</button>
							</div>
						{:else}
							<p class="px-3 pb-1 text-xs text-vc-muted">
								None yet. An agent asks to join with <code class="font-mono">npx visual-comments connect</code>.
							</p>
						{/each}
					</div>
				{/if}
				<MenuItem onselect={() => { close(); vc.signOut(); }}>Sign out</MenuItem>
			{/snippet}
		</Menu>
	{:else}
		<button type="button" part="button" class="{tool} px-3.5 font-medium" disabled={!vc.store.viewerKnown} onclick={() => vc.signIn()}>
			{vc.store.viewerKnown ? 'Sign in' : 'Connecting…'}
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
