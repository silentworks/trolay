<script lang="ts">
	import { currencyOptions } from '#lib/currencies.ts';

	interface Props {
		id: string;
		/** ISO 4217 code, or '' for none. */
		value: string;
	}

	let { id, value = $bindable() }: Props = $props();

	const options = currencyOptions();
</script>

<!-- A native select: on a phone it opens the system picker, which can be scrolled by name. -->
<select {id} class="input" bind:value>
	<option value="">None</option>
	{#each options as { code, name } (code)}
		<option value={code}>{name} ({code})</option>
	{/each}
</select>
