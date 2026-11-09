<script lang="ts">
	import { currencyOptions } from '#lib/currencies.ts';

	interface Props {
		id: string;
		/** ISO 4217 code, or '' for none. */
		value: string;
		/** Extra classes, e.g. to show it as a row's value. */
		class?: string;
		/** The id of a hint that describes it. */
		'aria-describedby'?: string;
	}

	let {
		id,
		value = $bindable(),
		class: extra = '',
		'aria-describedby': describedby
	}: Props = $props();

	const options = currencyOptions();
</script>

<!-- A native select: on a phone it opens the system picker, which can be scrolled by name. -->
<select {id} class={['input', extra]} aria-describedby={describedby} bind:value>
	<option value="">None</option>
	{#each options as { code, name } (code)}
		<option value={code}>{name} ({code})</option>
	{/each}
</select>
