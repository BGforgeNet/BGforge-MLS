import { i32 } from "typed-binary";
import { arraySpec, type FieldSpec, type SpecData } from "../../spec/types";

/**
 * Wire spec for a single MAP variables section (globals or locals): a
 * contiguous run of int32 values. The element count is decoded earlier in
 * the header (`numGlobalVars` / `numLocalVars`) and supplied via `ctx` at
 * read time.
 *
 * The orchestrator owns the binding between header counts and section
 * length: it must clamp the header-reported count against the remaining
 * buffer (a malformed file can request billions of slots) before passing
 * the count in. zod refinement cannot enforce the cross-struct relation,
 * which is why this spec carries no linked-count check.
 */
export interface VarSectionCtx {
    readonly count: number;
}

export const varSectionSpec = {
    values: arraySpec<VarSectionCtx>({
        element: { codec: i32 },
        count: { fromCtx: (ctx: VarSectionCtx) => ctx.count },
    }),
} satisfies Record<string, FieldSpec>;

export type VarSectionData = SpecData<typeof varSectionSpec>;
