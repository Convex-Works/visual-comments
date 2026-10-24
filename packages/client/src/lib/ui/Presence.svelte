<!--
  Who else is here: an avatar for each other person and agent present, the
  busiest first within each, beside the account button. Hover for what they do.
-->
<script lang="ts">
	import type { VisualComments } from '../visual-comments.svelte.js';
	import { activity, present, type Present } from '../core/presence.js';
	import Avatar from './Avatar.svelte';
	import { authorLabel } from './text.js';

	let { vc, size = 24 }: { vc: VisualComments; size?: number } = $props();

	const SHOWN = 4;
	const others = $derived(present(vc.participants.filter((p) => p.author.sub !== vc.viewer?.sub)));
	const shown = $derived(others.length > SHOWN ? others.slice(0, SHOWN - 1) : others);
	const rest = $derived(others.slice(shown.length));

	function describe(someone: Present) {
		const doing = someone.participants.map(activity).filter(Boolean);
		return [authorLabel(someone.author), ...doing].join('\n');
	}
</script>

{#if others.length}
	<ul class="flex items-center gap-1 px-1" aria-label="Here now">
		{#each shown as someone (someone.author.sub)}
			<li class="flex" aria-label={describe(someone)}>
				<Avatar user={someone.author} {size} title={describe(someone)} class={someone.state === 'working' ? 'vc-working' : ''} />
			</li>
		{/each}
		{#if rest.length}
			<li
				class="flex items-center justify-center rounded-full bg-current/15 text-[11px] font-medium"
				style:width="{size}px"
				style:height="{size}px"
				title={rest.map(describe).join('\n\n')}
				aria-label={rest.map(describe).join('\n\n')}
			>
				+{rest.length}
			</li>
		{/if}
	</ul>
{/if}
