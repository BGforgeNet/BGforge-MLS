import { getContext, setContext } from "svelte";
import type { Row } from "@bgforge/binary-editor";

/**
 * Open-another-resource callback, provided by LayoutRenderer and consumed deep in the field tree via Svelte
 * context - the same arrangement as `jump-context`, and for the same reason: the affordance sits several
 * components below whatever holds the host bridge.
 *
 * Distinct from a jump, which navigates within THIS record; this opens a different resource entirely, so it is
 * only ever offered for a resref the open game actually has (the host decides, via `row.openTarget`).
 */
export type OpenResourceFn = (target: NonNullable<Row["openTarget"]>) => void;

const OPEN_RESOURCE_KEY = Symbol("bin-open-resource");

export function provideOpenResource(fn: OpenResourceFn): void {
    setContext(OPEN_RESOURCE_KEY, fn);
}

export function useOpenResource(): OpenResourceFn | undefined {
    return getContext<OpenResourceFn | undefined>(OPEN_RESOURCE_KEY);
}
