import { getContext, setContext } from "svelte";

/**
 * Fetches the open game's creature-colour gradient table for the colour picker. Provided by LayoutRenderer
 * and consumed deep in the field tree via Svelte context - the same arrangement as `resource-list-context`,
 * and for the same reason: the control sits several components below whatever holds the host bridge.
 *
 * Absent outside a game, and resolves to an empty table when the install ships none - the field then keeps
 * its number and the picker has nothing to open.
 */
export type GradientTableFn = () => Promise<readonly (readonly string[])[]>;

const GRADIENT_TABLE_KEY = Symbol("bin-gradient-table");

export function provideGradientTable(fn: GradientTableFn): void {
    setContext(GRADIENT_TABLE_KEY, fn);
}

export function useGradientTable(): GradientTableFn | undefined {
    return getContext<GradientTableFn | undefined>(GRADIENT_TABLE_KEY);
}
