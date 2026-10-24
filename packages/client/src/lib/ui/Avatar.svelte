<!--
  A person's profile picture, or their initial on a colour of their own.
  An agent's has a badge, and says who added it when hovered.
-->
<script lang="ts" module>
	// Others get a stable colour from their id; the viewer keeps the account colour.
	const COLORS = ['#7b61ff', '#f24822', '#14ae5c', '#ffa629', '#0d99ff', '#e5487d', '#667799'];

	function colorFor(sub: string) {
		let hash = 0;
		for (const char of sub) hash = (hash * 31 + char.codePointAt(0)!) | 0;
		return COLORS[Math.abs(hash) % COLORS.length];
	}
</script>

<script lang="ts">
	import type { Author } from '../shared/types.js';
	import { useComments } from './context.js';
	import { authorLabel } from './text.js';

	let { user, size = 24, title, class: className = '' }: {
		user: Author;
		size?: number;
		/** Default: an agent's name and who added it. */
		title?: string;
		class?: string;
	} = $props();

	const vc = useComments();
	let failed = $state<string>();
	const initial = $derived(Array.from(user.name.trim() || '?')[0].toLocaleUpperCase());
	const self = $derived(vc?.viewer?.sub === user.sub);
	const badge = $derived(Math.max(10, Math.round(size * 0.45)));
</script>

<span
	class={['grid shrink-0 place-items-center rounded-full leading-none text-white select-none', className]}
	style:width="{size}px"
	style:height="{size}px"
	style:font-size="{Math.round(size * 0.5)}px"
	style:background={self ? 'var(--color-vc-avatar)' : colorFor(user.sub)}
	title={title ?? (user.agent ? authorLabel(user) : undefined)}
	aria-hidden="true"
>
	{#if user.picture && user.picture !== failed}
		<img src={user.picture} alt="" referrerpolicy="no-referrer" class="size-full rounded-full object-cover [grid-area:1/1]" draggable="false"
			onerror={() => { failed = user.picture; }} />
	{:else}
		<span class="[grid-area:1/1]">{initial}</span>
	{/if}
	{#if user.agent}
		<!-- Past the corner, like a status dot; nothing clips it. -->
		<span
			class="grid place-items-center self-end justify-self-end rounded-full bg-vc-agent text-white ring-[1.5px] ring-white [grid-area:1/1]"
			style:width="{badge}px"
			style:height="{badge}px"
			style:margin="0 {-badge / 4}px {-badge / 4}px 0"
		>
			<svg width={badge - 3} height={badge - 3} viewBox="0 0 24 24" fill="currentColor">
				<path d="M12 2c.8 5.6 4.4 9.2 10 10-5.6.8-9.2 4.4-10 10-.8-5.6-4.4-9.2-10-10 5.6-.8 9.2-4.4 10-10z" />
			</svg>
		</span>
	{/if}
</span>
