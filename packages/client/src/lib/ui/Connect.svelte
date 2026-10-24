<svelte:options css="injected" />

<!--
  Approving an agent. `visual-comments connect` sends the person to
  `#vc-connect=<id>`; Allow adds the agent to the space, under its own name.
  Signed out, it offers to sign in first; the address keeps the request.
-->
<script lang="ts">
	import type { Agent, AgentRequest } from '../shared/types.js';
	import { useComments } from './context.js';

	let { id }: { id: string } = $props();

	const vc = useComments();
	const space = $derived(vc.store.spaceName || 'this space');
	const signedIn = $derived(Boolean(vc.viewer));
	let request = $state<AgentRequest>();
	let joined = $state<Agent>();
	let failed = $state<string>();
	let busy = $state(false);

	$effect(() => {
		if (!signedIn) return;
		let current = true;
		request = undefined;
		failed = undefined;
		vc.store.agentRequest(id).then(
			(found) => { if (current) request = found; },
			(error: Error) => {
				if (!current) return;
				failed = error.message;
				// The sign-in may have lapsed since the page loaded; then this offers it again.
				void vc.store.refresh();
			}
		);
		return () => { current = false; };
	});

	async function answer(allow: boolean) {
		busy = true;
		failed = undefined;
		try {
			if (allow) joined = await vc.store.approveAgent(id);
			else {
				await vc.store.denyAgent(id);
				vc.endConnect();
			}
		} catch (error) {
			failed = (error as Error).message;
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	{@attach (node) => node.showModal()}
	onclose={() => vc.endConnect()}
	aria-labelledby="vc-connect-title"
	class="vc-ui pointer-events-auto m-auto w-[360px] max-w-[calc(100vw-24px)] rounded-[12px] bg-white p-5 text-[13px] text-vc-ink shadow-[0_8px_40px_rgb(0_0_0/0.28)] outline-none backdrop:bg-black/30"
>
	{#if !vc.viewer}
		<h2 id="vc-connect-title" class="text-[15px] font-semibold">An agent wants to join</h2>
		{#if vc.loading}
			<p class="mt-2 text-vc-muted">Connecting…</p>
		{:else}
			<p class="mt-2 text-vc-muted">Sign in to see which agent asks, and to let it read and write comments here.</p>
			<div class="mt-5 flex justify-end gap-2">
				<form method="dialog"><button class="vc-dialog-button">Cancel</button></form>
				<button type="button" class="vc-dialog-button vc-dialog-primary" onclick={() => vc.signIn()}>Sign in</button>
			</div>
		{/if}
	{:else if joined}
		<h2 id="vc-connect-title" class="text-[15px] font-semibold">{joined.name} joined {space}</h2>
		<p class="mt-2 text-vc-muted">It sees new comments and replies under its own name. Remove it from your account menu at any time.</p>
		<form method="dialog" class="mt-5 flex justify-end">
			<button class="vc-dialog-button vc-dialog-primary">Done</button>
		</form>
	{:else if request}
		<h2 id="vc-connect-title" class="text-[15px] font-semibold">{request.name} wants to join {space} as an agent</h2>
		<p class="mt-2 text-vc-muted">
			It will see every comment here, and may reply and act on them under its own name. Allow it only if you started it.
		</p>
		<p class="mt-4 text-vc-muted">The agent shows this code:</p>
		<p class="mt-1 rounded-[8px] bg-vc-surface py-2 text-center font-mono text-xl tracking-[0.2em]">{request.code}</p>
		{#if failed}<p role="alert" class="mt-3 text-red-600">{failed}</p>{/if}
		<div class="mt-5 flex justify-end gap-2">
			<button type="button" class="vc-dialog-button" disabled={busy} onclick={() => answer(false)}>Deny</button>
			<button type="button" class="vc-dialog-button vc-dialog-primary" disabled={busy} onclick={() => answer(true)}>Allow</button>
		</div>
	{:else if failed}
		<h2 id="vc-connect-title" class="text-[15px] font-semibold">This request cannot be answered</h2>
		<p class="mt-2 text-vc-muted">{failed}</p>
		<form method="dialog" class="mt-5 flex justify-end">
			<button class="vc-dialog-button">Close</button>
		</form>
	{:else}
		<h2 id="vc-connect-title" class="text-[15px] font-semibold">An agent wants to join</h2>
		<p class="mt-2 text-vc-muted">Loading…</p>
	{/if}
</dialog>

<style>
	.vc-dialog-button {
		height: 2rem;
		border-radius: 9999px;
		padding: 0 0.875rem;
		font-weight: 500;
		background: var(--color-vc-wash);
		outline: none;
	}
	.vc-dialog-button:hover:not(:disabled) {
		filter: brightness(0.96);
	}
	.vc-dialog-button:focus-visible {
		box-shadow: 0 0 0 2px var(--color-vc-comment);
	}
	.vc-dialog-button:disabled {
		opacity: 0.6;
	}
	.vc-dialog-primary {
		background: var(--color-vc-comment);
		color: white;
	}
	.vc-dialog-primary:focus-visible {
		box-shadow: 0 0 0 2px white, 0 0 0 4px var(--color-vc-comment);
	}
</style>
