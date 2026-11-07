<script lang="ts">
	interface Props {
		/** The line under "No stores yet", saying what adding one is for here. */
		line: string;
		/** Opens the New store sheet. */
		onadd: () => void;
	}

	let { line, onadd }: Props = $props();
</script>

<!-- The whole card adds the first store, named as one sentence after the other. -->
<button class="empty" type="button" aria-label="No stores yet. {line}" onclick={onadd}>
	<span class="icon">
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M4 9.5 5.5 4h13L20 9.5" />
			<path d="M4 9.5a2.67 2.67 0 0 0 5.33 0 2.67 2.67 0 0 0 5.34 0 2.67 2.67 0 0 0 5.33 0" />
			<path d="M5.5 12.5V20h13v-7.5" />
			<path d="M10 20v-4.5h4V20" />
		</svg>
	</span>
	<span class="title">No stores yet</span>
	<span class="line">{line}</span>
</button>

<style>
	/* No stores yet: a dashed card, all one button, that opens the New store sheet. */
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		width: 100%;
		margin-top: 8px;
		padding: 28px 20px;
		border: 2px dashed var(--control-border);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--muted);
		font: inherit;
		text-align: center;
		cursor: pointer;
	}

	.icon {
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		margin-bottom: 6px;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent-soft-text);
	}

	svg {
		width: 28px;
		height: 28px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.title {
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--text);
	}
</style>
