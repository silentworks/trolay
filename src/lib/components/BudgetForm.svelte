<script lang="ts">
	import { untrack } from 'svelte';
	import { minorToInput, parsePounds } from '#lib/money.ts';

	interface Props {
		budgetMinor?: number;
		onsave: (budgetMinor: number | undefined) => Promise<void>;
	}

	let { budgetMinor, onsave }: Props = $props();
	const uid = $props.id();

	const initial = untrack(() => budgetMinor);
	let value = $state(initial === undefined ? '' : minorToInput(initial));
	let error = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const minor = parsePounds(value);
		if (!minor) {
			error = 'Enter a budget like 50 or 42.50.';
			return;
		}
		await onsave(minor);
	}
</script>

<form onsubmit={submit} novalidate>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<div class="field">
		<label for="{uid}-budget">Budget (£)</label>
		<!-- svelte-ignore a11y_autofocus -->
		<input id="{uid}-budget" class="input" bind:value inputmode="decimal" autofocus />
		<span class="hint">Compared with the headline total, incl. or excl. VAT as shown.</span>
	</div>
	<button class="btn btn-primary btn-block" type="submit">Save budget</button>
	{#if budgetMinor !== undefined}
		<button class="btn btn-block remove" type="button" onclick={() => onsave(undefined)}>
			Remove budget
		</button>
	{/if}
</form>

<style>
	.remove {
		margin-top: 8px;
	}
</style>
