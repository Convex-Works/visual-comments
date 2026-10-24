<!-- A button that opens a popover menu below it. Items close the menu with `close()`. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		trigger,
		children,
		align = 'start',
		tone = 'light',
		class: className = '',
		onopen
	}: {
		/** Accessible name for the trigger. */
		label: string;
		trigger: Snippet;
		children: Snippet<[close: () => void]>;
		align?: 'start' | 'end';
		tone?: 'light' | 'dark';
		class?: string;
		/** Called as it opens, e.g. to load what it lists. */
		onopen?: () => void;
	} = $props();

	const id = $props.id();
	let button = $state<HTMLButtonElement>();
	let popover = $state<HTMLDivElement>();
	let open = $state(false);

	function place(event: ToggleEvent) {
		open = event.newState === 'open';
		if (event.newState !== 'open' || !button || !popover) return;
		onopen?.();
		const rect = button.getBoundingClientRect();
		const gutter = 12;
		const left = align === 'start' ? rect.left : rect.right - popover.offsetWidth;
		popover.style.left = `${Math.max(gutter, Math.min(left, window.innerWidth - popover.offsetWidth - gutter))}px`;
		popover.style.top = `${Math.max(gutter, Math.min(rect.bottom + 6, window.innerHeight - popover.offsetHeight - gutter))}px`;
	}

	const close = () => popover?.hidePopover();
</script>

<button
	bind:this={button}
	type="button"
	popovertarget="vc-menu-{id}"
	aria-label={label}
	aria-expanded={open}
	aria-controls="vc-menu-{id}"
	title={label}
	class={className}
>
	{@render trigger()}
</button>
<div
	bind:this={popover}
	id="vc-menu-{id}"
	popover="auto"
	ontoggle={place}
	class={[
		'vc-menu vc-ui fixed inset-auto m-0 max-h-[min(70vh,560px)] w-max min-w-52 max-w-[calc(100vw-24px)] overflow-y-auto rounded border p-1 text-[13px] shadow-lg',
		tone === 'dark'
			? 'border-white/10 bg-vc-ink text-white/90'
			: 'border-vc-line bg-vc-surface text-vc-ink'
	]}
>
	{@render children(close)}
</div>
