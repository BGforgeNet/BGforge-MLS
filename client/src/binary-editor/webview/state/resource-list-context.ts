import { getContext, setContext } from "svelte";

/**
 * Fetches every resref of one type the open game holds, for a resref field's picker. Provided by LayoutRenderer
 * and consumed deep in the field tree via Svelte context - the same arrangement as `open-resource-context`, and
 * for the same reason: the control sits several components below whatever holds the host bridge.
 *
 * Absent outside a game, and resolves to an empty list when the game has none of that type - a picker with
 * nothing to offer is still a working text field, since a resref is never confined to what is installed.
 */
export type ResourceListFn = (ext: string) => Promise<readonly string[]>;

const RESOURCE_LIST_KEY = Symbol("bin-resource-list");

export function provideResourceList(fn: ResourceListFn): void {
    setContext(RESOURCE_LIST_KEY, fn);
}

export function useResourceList(): ResourceListFn | undefined {
    return getContext<ResourceListFn | undefined>(RESOURCE_LIST_KEY);
}
