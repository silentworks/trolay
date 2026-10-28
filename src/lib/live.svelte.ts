import { liveQuery } from 'dexie';

/**
 * Reactive result of a Dexie query that re-runs whenever the tables it read change.
 * Create it during component initialisation; the subscription ends with the component.
 * The querier is captured once, so key the component on any id it depends on.
 */
export class LiveQuery<T> {
	current = $state<T>();
	loaded = $state(false);

	constructor(querier: () => T | Promise<T>) {
		$effect(() => {
			const subscription = liveQuery(querier).subscribe({
				next: (value) => {
					this.current = value;
					this.loaded = true;
				},
				error: (error) => console.error(error)
			});
			return () => subscription.unsubscribe();
		});
	}
}
