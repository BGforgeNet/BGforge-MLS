/**
 * Read every nested field of a value without copying it.
 *
 * A Svelte `$effect` tracks whatever it READS, so an effect that must re-run on any nested model
 * mutation needs a deep read of the model. `$state.snapshot` gives that read as a side effect of
 * building a deep CLONE - hundreds of milliseconds of main-thread time on a large dialog, paid on
 * every mutation. This is the read alone: it allocates nothing and returns nothing.
 *
 * The dialog model is JSON-safe by construction (it crosses postMessage to the host), so this
 * assumes a finite acyclic structure of plain objects and arrays and carries no cycle guard - a
 * cycle would already have broken the serialization the model exists to survive.
 */
export function deepRead(value: unknown): void {
    if (value === null || typeof value !== "object") return;

    if (Array.isArray(value)) {
        for (const item of value) deepRead(item);
        return;
    }

    for (const key of Object.keys(value)) {
        deepRead((value as Record<string, unknown>)[key]);
    }
}
