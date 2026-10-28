<script lang="ts">
	interface Props {
		message: string;
		actionLabel?: string;
		onaction?: () => void;
		ondismiss: () => void;
		durationMs?: number;
	}

	let { message, actionLabel, onaction, ondismiss, durationMs = 5000 }: Props = $props();

	$effect(() => {
		const timer = setTimeout(ondismiss, durationMs);
		return () => clearTimeout(timer);
	});
</script>

<div class="toast" role="status">
	<span>{message}</span>
	{#if actionLabel && onaction}
		<button class="btn btn-ghost" type="button" onclick={onaction}>{actionLabel}</button>
	{/if}
</div>

<style>
	.toast {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 4px 4px 4px 16px;
		border-radius: var(--radius);
		background: var(--text);
		color: var(--bg);
		font-weight: 600;
	}

	.toast .btn {
		color: var(--bg);
		text-decoration: underline;
	}
</style>
