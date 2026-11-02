<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { db } from '#lib/data/db.ts';
	import { addStore } from '#lib/data/stores.ts';
	import { startTrip } from '#lib/data/trips.ts';
	import { DEFAULT_VAT_BPS, formatPercent, parsePercent, parsePounds } from '#lib/money.ts';
	import AppHeader from './AppHeader.svelte';

	interface Props {
		/**
		 * A trip is already open (the guide was opened again from Account): only the explaining
		 * steps are shown, and nothing is created.
		 */
		explainOnly?: boolean;
		/** Skipped, or finished: with a new store and trip, unless `explainOnly`. */
		ondone: () => void;
	}

	let { explainOnly = false, ondone }: Props = $props();
	const uid = $props.id();

	type Step = 'welcome' | 'store' | 'vat' | 'budget' | 'ready';
	// Fixed for the guide's life: the page picks it once.
	const steps: Step[] = untrack(() => explainOnly)
		? ['welcome', 'ready']
		: ['welcome', 'store', 'vat', 'budget', 'ready'];
	let index = $state(0);
	const step = $derived(steps[index]);

	// Kept across Back and Next; the store and trip are only made on the last step.
	let name = $state('');
	let branch = $state('');
	let vat = $state(formatPercent(DEFAULT_VAT_BPS));
	let pricesIncludeTax = $state(true);
	let budget = $state('');
	let error = $state('');
	let saving = $state(false);

	let heading = $state<HTMLHeadingElement>();

	/** Each step's heading takes focus, so a screen reader starts reading the new step. */
	async function go(to: number) {
		error = '';
		index = to;
		await tick();
		heading?.focus();
	}

	function readBudget(): number | undefined | null {
		if (!budget.trim()) return undefined;
		const minor = parsePounds(budget);
		return minor && minor > 0 ? minor : null;
	}

	function next(event: SubmitEvent) {
		event.preventDefault();
		if (step === 'store' && !name.trim()) {
			error = 'Enter the name of the store, like Tesco or Lidl.';
			return;
		}
		if (step === 'vat' && parsePercent(vat) === null) {
			error = 'Enter a VAT rate between 0 and 100.';
			return;
		}
		if (step === 'budget' && readBudget() === null) {
			error = 'Enter a budget like 50 or 42.50, or leave it empty.';
			return;
		}
		if (step === 'ready') {
			void finish();
			return;
		}
		void go(index + 1);
	}

	async function finish() {
		if (explainOnly) {
			ondone();
			return;
		}
		saving = true;
		error = '';
		try {
			// Together, so the start screen never shows in between.
			await db.transaction('rw', db.stores, db.trips, async () => {
				const store = await addStore({
					name,
					branch,
					taxRateBps: parsePercent(vat) ?? DEFAULT_VAT_BPS,
					pricesIncludeTax
				});
				await startTrip(store.id, readBudget() ?? undefined);
			});
			ondone();
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}
</script>

<div class="page">
	<AppHeader
		title="Trolay"
		menu={[
			{ label: 'History', href: resolve('/history') },
			{ label: 'Stores', href: resolve('/stores') },
			{ label: 'Account', href: resolve('/account') }
		]}
	/>

	<p class="progress">Step {index + 1} of {steps.length}</p>

	<form onsubmit={next} novalidate aria-labelledby="{uid}-heading">
		{#if step === 'welcome'}
			<h2 id="{uid}-heading" tabindex="-1" bind:this={heading}>Welcome to Trolay</h2>
			<p>
				Trolay keeps a running total of your trolley while you shop, so the till holds no surprises.
			</p>
			<ul class="points">
				<li>Snap a shelf label and Trolay reads the price for you, or type it in.</li>
				<li>Set a budget and see how much is left as you go.</li>
				<li>At the till, check the total against your receipt.</li>
			</ul>
			<p class="hint">
				Everything stays on this phone, and you don't need an account. If you sign in, your stores
				and history sync between your phones, and you can share a trip with someone shopping with
				you. You can sign in any time from Account in the ⋮ menu.
			</p>
		{:else if step === 'store'}
			<h2 id="{uid}-heading" tabindex="-1" bind:this={heading}>Where are you shopping?</h2>
			<p class="hint">
				Trips are kept per store, so you can see what you spent at each one and pick the store
				quickly next time.
			</p>
			<div class="field">
				<label for="{uid}-name">Store name</label>
				<input
					id="{uid}-name"
					class="input"
					bind:value={name}
					required
					autocomplete="off"
					aria-invalid={error !== ''}
				/>
			</div>
			<div class="field">
				<label for="{uid}-branch">Branch or location <span class="hint">(optional)</span></label>
				<input id="{uid}-branch" class="input" bind:value={branch} autocomplete="off" />
			</div>
		{:else if step === 'vat'}
			<h2 id="{uid}-heading" tabindex="-1" bind:this={heading}>VAT at {name.trim()}</h2>
			<p class="hint">
				Trolay shows your total with and without VAT. Most UK shops charge 20% and print prices with
				VAT included, so you can usually keep these as they are.
			</p>
			<div class="field">
				<label for="{uid}-vat">VAT rate (%)</label>
				<input id="{uid}-vat" class="input" bind:value={vat} inputmode="decimal" />
			</div>
			<label class="check">
				<input type="checkbox" bind:checked={pricesIncludeTax} />
				Shelf labels include VAT
			</label>
			<p class="hint">
				Turn this off only if the store shows prices without VAT, as some trade and wholesale shops
				do.
			</p>
		{:else if step === 'budget'}
			<h2 id="{uid}-heading" tabindex="-1" bind:this={heading}>Set a budget for this trip?</h2>
			<p class="hint">
				Trolay shows how much of it is left as you add items. The total turns amber when you're
				close and red once you go over. You can change it during the trip.
			</p>
			<div class="field">
				<label for="{uid}-budget">Budget <span class="hint">(optional)</span></label>
				<input
					id="{uid}-budget"
					class="input"
					bind:value={budget}
					inputmode="decimal"
					placeholder="£"
					aria-invalid={readBudget() === null}
				/>
			</div>
		{:else}
			<h2 id="{uid}-heading" tabindex="-1" bind:this={heading}>How a trip works</h2>
			<ol class="points">
				<li>
					<strong>Add items.</strong> Tap 📷 Snap label and point the camera at the shelf label. Trolay
					reads the name and price, and you check them. Or tap Add by hand and type them in.
				</li>
				<li>
					<strong>Watch the total.</strong> The total at the bottom updates as you add items and change
					quantities.
				</li>
				<li>
					<strong>Check your receipt.</strong> At the till, tap Finish trip and enter the total on your
					receipt, or take a photo of it so Trolay reads it. Trolay tells you if the receipt doesn't match
					your trolley, so you can spot a wrong price before you leave.
				</li>
			</ol>
			<p class="hint">Finished trips are kept in History.</p>
		{/if}

		{#if error}<p class="error" role="alert">{error}</p>{/if}

		<div class="actions">
			<div class="row">
				{#if index > 0}
					<button class="btn" type="button" onclick={() => go(index - 1)}>Back</button>
				{/if}
				<button class="btn btn-primary grow" type="submit" disabled={saving}>
					{#if step === 'welcome'}
						Get started
					{:else if step === 'ready'}
						{explainOnly ? 'Back to your trolley' : 'Start shopping'}
					{:else if step === 'budget' && !budget.trim()}
						No budget
					{:else}
						Next
					{/if}
				</button>
			</div>
			{#if step !== 'ready'}
				<button class="btn btn-ghost skip" type="button" onclick={ondone}>Skip the guide</button>
			{/if}
		</div>
	</form>
</div>

<style>
	.page {
		max-width: 560px;
		margin: 0 auto;
		padding: 0 var(--gutter);
		padding-bottom: calc(140px + env(safe-area-inset-bottom));
	}

	.progress {
		color: var(--muted);
		font-size: 0.9rem;
		margin-bottom: 4px;
	}

	h2 {
		font-size: 1.5rem;
		margin: 0 0 12px;
	}

	h2:focus {
		outline: none;
	}

	.points {
		display: grid;
		gap: 10px;
		padding-left: 1.25rem;
	}

	.hint {
		color: var(--muted);
		font-weight: 400;
	}

	/* The main button sits at the bottom, within thumb reach. */
	.actions {
		position: fixed;
		inset: auto 0 0;
		display: grid;
		gap: 4px;
		padding: 12px var(--gutter) calc(12px + env(safe-area-inset-bottom));
		background: var(--bg);
		box-shadow: var(--shadow);
	}

	.row {
		display: flex;
		gap: 8px;
		width: 100%;
		max-width: 528px;
		margin: 0 auto;
	}

	.grow {
		flex: 1;
	}

	.skip {
		justify-self: center;
	}
</style>
