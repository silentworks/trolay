<script lang="ts">
	import InfoTip from '#lib/components/InfoTip.svelte';
	import { untrack } from 'svelte';
	import { amountLabel, minorToInput, parsePounds } from '#lib/money.ts';

	interface Props {
		budgetMinor?: number;
		onsave: (budgetMinor: number | undefined) => Promise<void>;
		/** The store's currency (ISO 4217); unset shows plain numbers. */
		currency?: string;
	}

	let { budgetMinor, onsave, currency }: Props = $props();
	const uid = $props.id();

	const initial = untrack(() => budgetMinor);
	let value = $state(initial === undefined ? '' : minorToInput(initial));
	let error = $state('');

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const minor = parsePounds(value);
		if (!minor) {
			error = `Enter a budget like 50 or ${minorToInput(4250)}.`;
			return;
		}
		await onsave(minor);
	}
</script>

<form onsubmit={submit} novalidate>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	<div class="field">
		<div class="with-info">
			<label for="{uid}-budget">{amountLabel('Budget', currency)}</label>
			<InfoTip title="Budget">
				<p>
					Trolay shows how much of it is left as you add items, against your total incl. tax. The
					bar turns amber when you're close and red once you go over.
				</p>
			</InfoTip>
		</div>
		<!-- svelte-ignore a11y_autofocus -->
		<input id="{uid}-budget" class="input" bind:value inputmode="decimal" autofocus />
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
