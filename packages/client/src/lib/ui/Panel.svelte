<!-- The threads of this page, or of every page. Choosing one shows it where it was placed. -->
<script lang="ts">
	import { fly } from 'svelte/transition';
	import { useComments } from './context.js';
	import Avatar from './Avatar.svelte';
	import Icon from './Icon.svelte';
	import Menu from './Menu.svelte';
	import MenuItem from './MenuItem.svelte';
	import { commentText } from './text.js';
	import { ago, fullDate } from '../core/time.js';
	import type { CommentThread } from '../shared/types.js';

	let { onselect, onclose, class: className = '', style = '' }: {
		onselect: (thread: CommentThread) => void;
		onclose: () => void;
		class?: string;
		style?: string;
	} = $props();

	const vc = useComments();
	const comments = vc.store;
	const filters = $derived(vc.filters);
	const viewer = $derived(vc.viewer);

	const lastActivity = (thread: CommentThread) => thread.comments.at(-1)?.createdAt ?? thread.createdAt;
	/** Threads on other pages, which the list shows only when asked. */
	const elsewhere = $derived(comments.threads.filter((t) => t.page !== vc.page).length);
	const here = $derived(comments.threads.filter((t) => filters.allPages || t.page === vc.page));
	const resolvedCount = $derived(here.filter((t) => t.resolvedAt).length);

	const visible = $derived.by(() => {
		const query = filters.query.trim().toLocaleLowerCase();
		const matches = (thread: CommentThread) =>
			!query ||
			`#${thread.id}` === query ||
			vc.titleOf(thread).toLocaleLowerCase().includes(query) ||
			thread.comments.some((c) =>
				c.body.toLocaleLowerCase().includes(query) || c.author.name.toLocaleLowerCase().includes(query));
		const list = here.filter((thread) =>
			(filters.showResolved || !thread.resolvedAt) &&
			(!filters.onlyMine || thread.comments.some((c) => c.author.sub === viewer?.sub)) &&
			matches(thread));
		// By page, then by the surface's place on it.
		const order = (thread: CommentThread) => vc.orderOf(thread);
		return filters.sort === 'place'
			? list.sort((a, b) => a.page.localeCompare(b.page) || order(a) - order(b) || a.id - b.id)
			: list.sort((a, b) => lastActivity(b) - lastActivity(a));
	});

	function copyLink(thread: CommentThread) {
		void navigator.clipboard?.writeText(vc.linkOf(thread));
	}
</script>

<aside
	data-vc-ui
	aria-label="Comments"
	class={['pointer-events-auto flex min-h-0 flex-col overflow-hidden rounded border border-vc-line bg-white text-[13px] text-vc-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]', className]}
	{style}
	transition:fly={{ x: 16, duration: 160 }}
>
	<header class="flex h-11 shrink-0 items-center gap-0.5 pr-1.5 pl-3.5">
		<h2 class="min-w-0 flex-1 truncate font-semibold" title={comments.spaceName || undefined}>Comments</h2>
		<Menu label="Filter and sort" align="end" class="vc-tool-light size-7 rounded-full">
			{#snippet trigger()}<Icon name="filter" />{/snippet}
			{#snippet children(close)}
				<MenuItem checked={filters.sort === 'date'} onselect={() => { close(); filters.sort = 'date'; }}>Sort by date</MenuItem>
				<MenuItem checked={filters.sort === 'place'} onselect={() => { close(); filters.sort = 'place'; }}>Sort by place</MenuItem>
				<div class="my-1 border-t border-vc-line"></div>
				{#if elsewhere || filters.allPages}
					<MenuItem checked={filters.allPages} onselect={() => { close(); filters.allPages = !filters.allPages; }}>
						Show every page
					</MenuItem>
				{/if}
				<MenuItem checked={filters.showResolved} onselect={() => { close(); filters.showResolved = !filters.showResolved; }}>
					Show resolved comments
				</MenuItem>
				{#if viewer}
					<MenuItem checked={filters.onlyMine} onselect={() => { close(); filters.onlyMine = !filters.onlyMine; }}>
						Only your threads
					</MenuItem>
					<div class="my-1 border-t border-vc-line"></div>
					<MenuItem checked={false} onselect={() => { close(); void comments.markAllRead(); }}>Mark all as read</MenuItem>
				{/if}
			{/snippet}
		</Menu>
		<button type="button" class="vc-tool-light size-7 rounded-full" title="Close comments (C)" aria-label="Close comments" onclick={onclose}>
			<Icon name="close" />
		</button>
	</header>

	<div class="shrink-0 border-b border-vc-line px-2.5 pb-2.5">
		<label class="flex h-8 items-center gap-2 rounded-[6px] bg-vc-surface px-2.5 text-vc-muted focus-within:ring-1 focus-within:ring-vc-comment">
			<Icon name="search" size={15} />
			<input
				type="search"
				placeholder="Search"
				aria-label="Search comments"
				bind:value={filters.query}
				onkeydown={(event) => { if (event.key === 'Escape') { filters.query = ''; (event.target as HTMLElement).blur(); } }}
				class="min-w-0 flex-1 bg-transparent text-vc-ink outline-none placeholder:text-vc-muted/80"
			/>
		</label>
	</div>

	{#if !viewer && !comments.loading}
		<div class="shrink-0 border-b border-vc-line px-3.5 py-3">
			<p>Sign in to see comments and add your own.</p>
			<button type="button" class="mt-2 h-7 rounded-full bg-vc-comment px-3 font-medium text-white hover:brightness-110"
				onclick={() => vc.signIn()}>Sign in</button>
		</div>
	{/if}

	<ol class="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
		{#each visible as thread (thread.id)}
			{@const root = thread.comments[0]}
			{@const replies = thread.comments.length - 1}
			{@const selected = thread.id === vc.openId}
			<li class={['group relative rounded-[8px] px-3 py-2.5', selected ? 'bg-vc-comment-soft' : 'hover:bg-vc-surface']}>
				<button
					type="button"
					class="absolute inset-0 rounded-[8px] focus-visible:outline-2 focus-visible:outline-vc-comment"
					aria-label="Show comment #{thread.id} on {vc.titleOf(thread)}"
					aria-current={selected || undefined}
					onclick={() => onselect(thread)}
				></button>
				<div class={['pointer-events-none relative', thread.resolvedAt && 'opacity-55']}>
					<div class="flex h-7 items-center">
						{#if thread.unread}
							<span class="absolute top-3 -left-2 size-1.5 rounded-full bg-vc-comment" title="Unread"></span>
						{/if}
						<Avatar user={root.author} size={28} />
					</div>
					<p class="mt-1.5 truncate text-vc-muted">#{thread.id} · {vc.titleOf(thread)}</p>
					<p class="truncate">
						<span class="font-medium">{root.author.name}</span>
						<time class="ml-1 text-vc-muted" title={fullDate(root.createdAt)}>{ago(root.createdAt, comments.now)}</time>
					</p>
					<p class={['line-clamp-3 break-words whitespace-pre-line', thread.unread && 'font-medium']}>{commentText(root)}</p>
					{#if replies > 0}
						<p class="mt-1 text-xs text-vc-muted">
							{replies} {replies === 1 ? 'reply' : 'replies'}
						</p>
					{/if}
				</div>
				{#if viewer}
					<div class="absolute top-2.5 right-2 flex items-center">
						<div class={['transition-opacity', !selected && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100']}>
							<Menu label="Thread options" align="end" class="vc-tool-light size-7 rounded-full">
								{#snippet trigger()}<Icon name="more" />{/snippet}
								{#snippet children(close)}
									<MenuItem onselect={() => { close(); void comments.markRead(thread.id, !thread.unread); }}>
										{thread.unread ? 'Mark as read' : 'Mark as unread'}
									</MenuItem>
									<MenuItem onselect={() => { close(); copyLink(thread); }}>Copy link</MenuItem>
									{#if root.author.sub === viewer.sub}
										<MenuItem onselect={() => {
											close();
											if (confirm('Delete this thread and all its replies?')) void comments.removeThread(thread.id);
										}}>Delete thread…</MenuItem>
									{/if}
								{/snippet}
							</Menu>
						</div>
						<button
							type="button"
							class={['vc-tool-light size-7 rounded-full', thread.resolvedAt && 'text-vc-comment']}
							aria-pressed={Boolean(thread.resolvedAt)}
							title={thread.resolvedAt ? 'Reopen' : 'Resolve'}
							aria-label={thread.resolvedAt ? `Reopen #${thread.id}` : `Resolve #${thread.id}`}
							onclick={() => comments.resolve(thread.id, !thread.resolvedAt)}
						>
							<Icon name="resolve" size={18} />
						</button>
					</div>
				{/if}
			</li>
		{:else}
			{#if viewer && !comments.loading}
				<li class="px-3 py-6 text-center text-vc-muted">
					{#if filters.query.trim()}
						No comments match “{filters.query.trim()}”.
					{:else if filters.onlyMine}
						You have not started or replied to any threads.
					{:else if resolvedCount && !filters.showResolved}
						Every thread is resolved.
						<button type="button" class="text-vc-comment hover:underline" onclick={() => (filters.showResolved = true)}>
							Show resolved
						</button>
					{:else}
						No comments yet. Click {vc.surfaces.some((s) => s.element) ? 'a frame' : 'anywhere on the page'} to add one.
					{/if}
				</li>
			{/if}
		{/each}
	</ol>

	{#if comments.error}
		<div role="alert" class="m-2 mt-0 flex shrink-0 items-start gap-2 rounded-[8px] bg-vc-ink px-3 py-2 text-white">
			<p class="flex-1">{comments.error}</p>
			<button type="button" class="text-white/70 hover:text-white" aria-label="Dismiss" onclick={() => (comments.error = null)}>
				<Icon name="close" size={14} />
			</button>
		</div>
	{/if}
</aside>
