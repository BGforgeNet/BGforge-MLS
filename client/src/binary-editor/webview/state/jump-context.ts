import { getContext, setContext } from "svelte";
import type { Row } from "@bgforge/binary-editor";

/**
 * Cross-record jump callback, provided by LayoutRenderer and consumed deep in the field tree (Field.svelte)
 * via Svelte context - so the click-to-navigate affordance doesn't have to be threaded through every
 * intervening component (ListBlock -> ListSection -> ListEntryDetail -> FormSection -> Field). Absent for
 * formats/views with no jump links (the field renders no affordance).
 */
export type JumpFn = (link: NonNullable<Row["link"]>) => void;

const JUMP_KEY = Symbol("bin-jump");

export function provideJump(fn: JumpFn): void {
    setContext(JUMP_KEY, fn);
}

export function useJump(): JumpFn | undefined {
    return getContext<JumpFn | undefined>(JUMP_KEY);
}
