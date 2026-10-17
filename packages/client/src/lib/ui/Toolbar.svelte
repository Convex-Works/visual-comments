<!-- The floating toolbar: comment mode and the account, at the bottom of the window. -->
<script lang="ts">
	import Account from './Account.svelte';
	import { useComments } from './context.js';
	import Icon from './Icon.svelte';

	const vc = useComments();
</script>

<div data-vc-ui class="pointer-events-auto absolute bottom-4 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
	{#if vc.store.error && !vc.active}
		<div role="alert" class="flex max-w-80 items-start gap-2 rounded-[8px] bg-vc-ink px-3 py-2 text-white shadow-lg">
			<p class="flex-1">{vc.store.error}</p>
			<button type="button" class="text-white/70 hover:text-white" aria-label="Dismiss" onclick={() => (vc.store.error = null)}>
				<Icon name="close" size={14} />
			</button>
		</div>
	{/if}
	<div class="flex items-center gap-0.5 rounded-full bg-vc-island p-1 text-vc-island-ink shadow-[0_2px_10px_rgb(0_0_0/0.2)] backdrop-blur-[5px]">
		<button
			type="button"
			class="vc-island-tool relative"
			aria-pressed={vc.active}
			aria-label="Comments"
			title="Comments{vc.options.shortcut === false ? '' : ` (${(vc.options.shortcut ?? 'c').toUpperCase()})`}"
			onclick={() => vc.toggle()}
		>
			<Icon name="comment" />
			{#if vc.unreadCount && !vc.active}
				<span class="absolute top-1 right-1 size-2 rounded-full bg-vc-comment"></span>
			{/if}
		</button>
		<Account {vc} />
	</div>
</div>
