<svelte:options css="injected" />

<!--
  Pins, the new-comment field and the open thread, drawn over the page in
  client pixels. Each surface says where its pixels are on screen, so pins
  follow it however it is zoomed, panned or scrolled. Cards open on whichever
  side of a pin has room inside the surface's stage. It also outlines the
  element the pointer is aiming at, the new comment's element and the open
  thread's.
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import { useComments } from './context.js';
	import Composer from './Composer.svelte';
	import Pin from './Pin.svelte';
	import ThreadCard from './ThreadCard.svelte';
	import Icon from './Icon.svelte';
	import { describeTarget, MAGNET, widen, type Box } from '../core/target.js';
	import { docBoxToClient, docBoxToSurface, intersect, spotOf, toClient, type Rect, type Surface } from '../core/surfaces.js';
	import { neck } from '../core/metaball.js';
	import { activity } from '../core/presence.js';
	import type { CommentImage, CommentThread } from '../shared/types.js';

	const vc = useComments();
	const comments = vc.store;
	const PIN = 32;
	const GAP = 10;
	const EDGE = 8;
	const CARD_WIDTH = 320;
	const COMPOSER_WIDTH = 296;

	let composer = $state<Composer>();
	let cardHeight = $state(0);
	let shake = $state(false);

	/** Brings the unsent comment back to attention instead of discarding it. */
	function focusDraft() {
		composer?.focus();
		shake = false;
		requestAnimationFrame(() => (shake = true));
	}
	$effect(() => {
		vc.onFocusDraft(focusDraft);
		return () => vc.onFocusDraft(undefined);
	});

	/** Where cards on a surface can go: its stage, clear of the list. */
	function stageOf(surface: Surface): Rect {
		const panel = vc.active ? vc.panelRect ?? floatingPanel() : undefined;
		const stage = intersect(surface.stage, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
		return panel && panel.left < stage.right && panel.left > stage.left ? { ...stage, right: panel.left } : stage;
	}

	/** The list's place when the host gives it none: along the right edge. */
	function floatingPanel(): Rect {
		return { left: innerWidth - 12 - 320, top: 12, right: innerWidth - 12, bottom: innerHeight - 12 };
	}

	/** A thread's pin where it is now, or undefined while it is not on screen. */
	function spot(thread: CommentThread) {
		void vc.layout;
		const surface = vc.surface(thread.surface);
		if (!surface) return undefined;
		return { surface, ...spotOf(surface, thread) };
	}

	// Opening a thread scrolls its element into view inside its document, once found.
	$effect(() => {
		void vc.layout;
		const id = vc.revealing;
		if (id === undefined) return;
		untrack(() => {
			const thread = comments.threads.find((t) => t.id === id);
			if (!thread?.anchor) return void (vc.revealing = undefined);
			const where = spot(thread);
			if (!where?.surface.doc) return;
			if (where.element && where.hidden) vc.revealElement(where.element);
			else vc.revealing = undefined;
		});
	});

	const pins = $derived(vc.pinned.flatMap((thread) => {
		const where = spot(thread);
		return where && !where.hidden ? [{ thread, left: where.x, top: where.y }] : [];
	}));

	/** Per thread, what those working on it say they are doing. */
	const working = $derived.by(() => {
		const lines = new Map<number, string>();
		for (const participant of vc.participants) {
			if (participant.state !== 'working' || participant.thread === undefined) continue;
			const line = activity(participant)!;
			const before = lines.get(participant.thread);
			lines.set(participant.thread, before ? `${before} · ${line}` : line);
		}
		return lines;
	});

	/** Beside the pin, on the side with room, kept inside the stage. */
	function beside(at: { left: number; top: number }, width: number, height: number, bounds: Rect) {
		let left = at.left + PIN + GAP;
		if (left + width > bounds.right - EDGE) left = at.left - GAP - width;
		left = Math.max(bounds.left + EDGE, Math.min(left, bounds.right - EDGE - width));
		const top = Math.max(bounds.top + EDGE, Math.min(at.top - PIN, bounds.bottom - EDGE - height));
		return { left, top };
	}

	const open = $derived.by(() => {
		const thread = vc.open;
		const where = thread && spot(thread);
		if (!thread || !where || where.hidden) return undefined;
		const bounds = stageOf(where.surface);
		const at = { left: where.x, top: where.y };
		return { thread, where, card: beside(at, CARD_WIDTH, cardHeight, bounds), maxHeight: bounds.bottom - bounds.top - EDGE * 2 };
	});

	/** A client box with a little room around it, and its corner radius on screen. */
	function outline(rect: Rect, radius = 0) {
		const pad = 3;
		return {
			left: rect.left - pad,
			top: rect.top - pad,
			width: rect.right - rect.left + pad * 2,
			height: rect.bottom - rect.top + pad * 2,
			radius: radius + pad
		};
	}

	const aimSurface = $derived(vc.aim && vc.surface(vc.aim.surface));
	const aiming = $derived.by(() => {
		const aim = vc.aim;
		if (!aim?.target || !aimSurface) return undefined;
		const shape = outline(docBoxToClient(aimSurface, aim.target.box), aim.target.radius * aimSurface.docScale);
		// Like a pointer resting on a button, the outline leans a little toward the pointer.
		const box = aim.targetBox!;
		const lean = (offset: number, size: number) => Math.max(-1, Math.min(1, offset / (size / 2 || 1))) * 3;
		return {
			...shape,
			dx: lean(aim.point.x - (box.x + box.width / 2), box.width),
			dy: lean(aim.point.y - (box.y + box.height / 2), box.height)
		};
	});

	/**
	 * Over an element the cursor becomes a faint dot, joined to the outline
	 * while the pointer is outside it.
	 */
	const DOT = 4;
	const dot = $derived.by(() => {
		const cursor = vc.cursor;
		if (!cursor || !aiming) return undefined;
		const box = {
			left: aiming.left + aiming.dx,
			top: aiming.top + aiming.dy,
			width: aiming.width,
			height: aiming.height,
			radius: aiming.radius
		};
		return { ...cursor, neck: neck(cursor.x, cursor.y, DOT, box, MAGNET + 8) };
	});

	const draftSurface = $derived(vc.draft && vc.surface(vc.draft.surface));
	/** The new comment's element where it is now, following any scroll since the click, in surface pixels. */
	const draftBox = $derived.by((): Box | undefined => {
		void vc.layout;
		const target = vc.draft?.target;
		if (!target || !draftSurface) return undefined;
		if (!target.element.isConnected) return vc.draft!.targetBox;
		const r = target.element.getBoundingClientRect();
		return docBoxToSurface(draftSurface, { x: r.left, y: r.top, width: r.width, height: r.height });
	});
	const drafted = $derived.by(() => {
		const target = vc.draft?.target;
		if (!target || !draftBox || !draftSurface) return undefined;
		const a = toClient(draftSurface, draftBox.x, draftBox.y);
		const s = draftSurface.scale;
		return outline({ left: a.x, top: a.y, right: a.x + draftBox.width * s, bottom: a.y + draftBox.height * s }, target.radius * draftSurface.docScale);
	});
	const wider = $derived(vc.draft?.target && draftSurface && widen(vc.draft.target, draftSurface.search));
	const anchored = $derived(open?.thread.anchor && open.where.box && outline(open.where.box));
	/** The new comment's element, or else the open thread's. */
	const marked = $derived(drafted || (vc.draft ? undefined : anchored));

	/** Moves the comment to another element, keeping the pin at the same place on screen. */
	function retarget(target: NonNullable<typeof vc.draft>['target']) {
		const draft = vc.draft;
		if (!draft || !draftSurface || !target) return;
		draft.target = target;
		draft.targetBox = docBoxToSurface(draftSurface, target.box);
		composer?.focus();
	}

	function widenDraft() {
		if (!vc.draft?.target || !wider) return;
		vc.draft.inner = [vc.draft.target, ...(vc.draft.inner ?? [])];
		retarget(wider);
	}

	function narrowDraft() {
		const [inner, ...rest] = vc.draft?.inner ?? [];
		if (!vc.draft || !inner) return;
		vc.draft.inner = rest;
		retarget(inner);
	}

	/** Leaves the element and pins the comment where the pointer was. */
	function detachDraft() {
		const draft = vc.draft;
		if (!draft) return;
		draft.x = draft.point.x;
		draft.y = draft.point.y;
		draft.target = undefined;
		draft.targetBox = undefined;
		draft.inner = undefined;
		composer?.focus();
	}

	function onDraftKeydown(event: KeyboardEvent) {
		if (!event.altKey || event.metaKey || event.ctrlKey) return;
		if (event.key === 'ArrowUp') widenDraft();
		else if (event.key === 'ArrowDown') narrowDraft();
		else return;
		event.preventDefault();
	}

	const pending = $derived.by(() => {
		const draft = vc.draft;
		if (!draft || !draftSurface) return undefined;
		const box = draft.targetBox && draftBox;
		const x = box ? box.x + draft.x - draft.targetBox!.x : draft.x;
		const y = box ? box.y + draft.y - draft.targetBox!.y : draft.y;
		const c = toClient(draftSurface, x, y);
		const at = { left: c.x, top: c.y };
		return { at, card: beside({ left: at.left, top: at.top + 4 }, COMPOSER_WIDTH, 40, stageOf(draftSurface)) };
	});

	async function submitDraft(body: string, images: CommentImage[]) {
		const draft = vc.draft;
		const surface = draftSurface;
		if (!draft || !surface) return;
		try {
			const anchor = draft.target && draft.targetBox
				? { ...describeTarget(draft.target), ...draft.targetBox }
				: null;
			const thread = await comments.create({
				page: vc.page,
				url: location.href,
				surface: surface.id,
				title: surface.title || document.title,
				x: draft.x,
				y: draft.y,
				anchor,
				context: contextFor(surface),
				body
			}, images);
			vc.draft = undefined;
			vc.openThread(thread.id);
		} catch (error) {
			comments.error = (error as Error).message;
			throw error;
		}
	}

	function contextFor(surface: Surface): Record<string, string> {
		const extra = vc.options.context?.({ id: surface.id, title: surface.title, element: surface.element }) ?? {};
		const entries = Object.entries({ viewport: `${innerWidth}×${innerHeight}`, ...surface.context, ...extra })
			.filter(([, value]) => value !== undefined && value !== '')
			.map(([key, value]) => [key, String(value)]);
		return Object.fromEntries(entries);
	}
</script>

{#if vc.cursor}
	<!-- The .vc-comment-cursor image, drawn. Its hotspot is the bottom-left point. -->
	<svg
		class={['vc-cursor', aiming && 'vc-cursor-hidden']}
		style:left="{vc.cursor.x - 1}px"
		style:top="{vc.cursor.y - 27}px"
		width="28"
		height="28"
		viewBox="0 0 28 28"
		aria-hidden="true"
	>
		<path d="M14 1.5a12.5 12.5 0 1 1 0 25H1.5V14A12.5 12.5 0 0 1 14 1.5z" fill="white" stroke="#1c1917" stroke-width="1.5" />
		<path d="M14 9v10M9 14h10" stroke="#1c1917" stroke-width="1.5" stroke-linecap="round" />
	</svg>
{/if}
{#if dot}
	<svg class="vc-dot" aria-hidden="true">
		<g>
			{#if dot.neck}<path d={dot.neck} />{/if}
			<circle cx={dot.x} cy={dot.y} r={DOT} />
		</g>
	</svg>
{/if}
{#if aiming}
	<span
		class="vc-target vc-target-aim absolute"
		style:left="{aiming.left}px"
		style:top="{aiming.top}px"
		style:width="{aiming.width}px"
		style:height="{aiming.height}px"
		style:border-radius="{aiming.radius}px"
		style:translate="{aiming.dx}px {aiming.dy}px"
		aria-hidden="true"
	></span>
{/if}
{#if marked}
	<span
		class={['vc-target absolute', !drafted && 'vc-target-quiet']}
		style:left="{marked.left}px"
		style:top="{marked.top}px"
		style:width="{marked.width}px"
		style:height="{marked.height}px"
		style:border-radius="{marked.radius}px"
		aria-hidden="true"
	></span>
{/if}

{#each pins as pin (pin.thread.id)}
	<Pin
		thread={pin.thread}
		left={pin.left}
		top={pin.top}
		now={comments.now}
		working={working.get(pin.thread.id)}
		open={pin.thread.id === vc.openId}
		onopen={() => {
			vc.draft = undefined;
			vc.openThread(pin.thread.id === vc.openId ? undefined : pin.thread.id);
		}}
	/>
{/each}

{#if pending && vc.draft}
	<span
		class="vc-draft-pin absolute z-20 block size-8 bg-vc-comment shadow-[0_1px_4px_rgb(0_0_0/0.3)]"
		style:left="{pending.at.left}px"
		style:top="{pending.at.top}px"
		aria-hidden="true"
	></span>
	<!-- Alt+Up and Alt+Down from the field widen or narrow the comment's element. -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		data-vc-ui
		class={['pointer-events-auto absolute z-40 cursor-default', shake && 'vc-shake']}
		style:left="{pending.card.left}px"
		style:top="{pending.card.top}px"
		role="group"
		aria-label="New comment"
		onanimationend={() => (shake = false)}
		onkeydown={onDraftKeydown}
	>
		{#if vc.viewer}
			<Composer
				bind:this={composer}
				variant="new"
				placeholder="Add a comment"
				initial={vc.draft.text}
				autofocus
				oninput={(text) => { if (vc.draft) vc.draft.text = text; }}
				onimages={(count) => { if (vc.draft) vc.draft.images = count; }}
				onsubmit={submitDraft}
				oncancel={() => (vc.draft = undefined)}
			/>
			{#if vc.draft.target}
				<div class="mt-1.5 flex w-fit max-w-[296px] items-center rounded-full bg-white py-0.5 pr-0.5 pl-3 text-xs text-vc-muted shadow-[0_1px_6px_rgb(0_0_0/0.16)]">
					<span class="min-w-0 truncate pr-1" title={vc.draft.target.label}>On {vc.draft.target.label}</span>
					{#if vc.draft.inner?.length}
						<button type="button" class="vc-target-tool" aria-label="Select the element inside" title="Inside (⌥↓)" onclick={narrowDraft}>
							<Icon name="chevron-down" size={14} />
						</button>
					{/if}
					{#if wider}
						<button type="button" class="vc-target-tool" aria-label="Select the element around it" title="Around it (⌥↑)" onclick={widenDraft}>
							<Icon name="chevron-up" size={14} />
						</button>
					{/if}
					<button type="button" class="vc-target-tool" aria-label="Pin to the point instead" title="Pin to the point instead" onclick={detachDraft}>
						<Icon name="close" size={14} />
					</button>
				</div>
			{/if}
		{:else}
			<div class="flex w-[296px] items-center gap-3 rounded-[18px] bg-white py-2 pr-2 pl-4 text-[13px] text-vc-ink shadow-[0_2px_14px_rgb(0_0_0/0.18)]">
				<p class="flex-1">Sign in to comment.</p>
				<button type="button" class="h-7 rounded-full bg-vc-comment px-3 font-medium text-white hover:brightness-110"
					onclick={() => vc.signIn()}>Sign in</button>
			</div>
		{/if}
	</div>
{/if}

{#if open}
	<div
		class="absolute z-40"
		style:left="{open.card.left}px"
		style:top="{open.card.top}px"
		bind:offsetHeight={cardHeight}
	>
		<ThreadCard
			thread={open.thread}
			title={vc.titleOf(open.thread)}
			link={vc.linkOf(open.thread)}
			maxHeight={Math.max(200, open.maxHeight)}
			onclose={() => vc.openThread(undefined)}
		/>
	</div>
{/if}

<style>
	.vc-cursor {
		position: fixed;
		z-index: 50;
		transform-origin: 1px 27px;
		transition: opacity 140ms ease, scale 140ms ease;
	}
	.vc-cursor-hidden {
		opacity: 0;
		scale: 0.6;
	}
	.vc-dot {
		position: fixed;
		inset: 0;
		z-index: 50;
		width: 100%;
		height: 100%;
		overflow: visible;
		animation: vc-dot-in 140ms ease;
	}
	/* One group, so where the neck overlaps the dot it is not darker. */
	.vc-dot g {
		fill: var(--color-vc-comment);
		opacity: 0.5;
	}
	@keyframes vc-dot-in {
		from {
			opacity: 0;
		}
	}
	.vc-target {
		border: 2px solid var(--color-vc-comment);
		background: color-mix(in srgb, var(--color-vc-comment) 8%, transparent);
	}
	.vc-target-aim {
		transition-property: left, top, width, height, border-radius, translate;
		transition-duration: 110ms, 110ms, 110ms, 110ms, 110ms, 60ms;
		transition-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
		animation: vc-target-in 110ms ease-out;
	}
	@keyframes vc-target-in {
		from {
			opacity: 0;
			scale: 1.06;
		}
	}
	.vc-target-quiet {
		border: 1.5px dashed var(--color-vc-comment);
		background: none;
	}
	.vc-target-tool {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 999px;
		color: var(--color-vc-muted);
	}
	.vc-target-tool:hover {
		background: var(--color-vc-wash);
		color: var(--color-vc-ink);
	}
	.vc-draft-pin {
		border-radius: 16px 16px 16px 0;
		transform: translateY(-100%);
		animation: vc-drop 180ms cubic-bezier(0.2, 0.9, 0.3, 1.3);
		transform-origin: bottom left;
	}
	@keyframes vc-drop {
		from {
			transform: translateY(-100%) scale(0.4);
			opacity: 0;
		}
	}
	.vc-shake {
		animation: vc-shake 320ms ease;
	}
	@keyframes vc-shake {
		20%, 60% { translate: -6px 0; }
		40%, 80% { translate: 6px 0; }
	}
	@media (prefers-reduced-motion: reduce) {
		.vc-draft-pin,
		.vc-shake,
		.vc-target-aim,
		.vc-cursor,
		.vc-dot {
			animation: none;
			transition: none;
		}
	}
</style>
