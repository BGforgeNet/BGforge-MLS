/**
 * Inline validation surfaced in the editor's Issues panel: the errors that would break a SAVED dialog.
 *
 * Kept pure (a model in, a string list out) so it is unit-tested without the Svelte runtime - the
 * derived-state and per-root scoping below are exactly the parts that regress into false positives.
 */
import type { DialogModel } from "../../../../shared/dialog-model";

/**
 * Two error classes matter for a saved .d/.ssl:
 *
 * - **Duplicate state label** - two states with the same label in the SAME dialog (root) collide on save.
 *   Scoped per root (labels are unique per DLG, not globally) and to SOURCE-authored states only: an
 *   editor-synthesized CHAIN/INTERJECT/EXTEND-derived id is a projection artifact, and two chains that
 *   converge on the same terminal legitimately produce the same derived id without being a real duplicate
 *   (the x#viconia.d VISK1 case). Flagging those is a false positive.
 * - **Dangling transition** - a `state` target whose id is not present anywhere in the file. Checked
 *   against every state id (derived included), since a transition may legitimately target a derived state.
 */
export function dialogIssues(model: DialogModel): string[] {
    const out: string[] = [];
    const allIds = new Set(model.roots.flatMap((r) => r.states.map((s) => s.id)));

    for (const r of model.roots) {
        const seen = new Set<string>();
        for (const s of r.states) {
            if (s.derivedFrom) continue; // synthesized id; a collision here is not a real source duplicate
            if (seen.has(s.id)) out.push(`Duplicate state label: ${s.id}`);
            seen.add(s.id);
        }
    }

    for (const r of model.roots) {
        for (const s of r.states) {
            for (const c of s.choices) {
                if (c.target.kind === "state" && !allIds.has(c.target.stateId)) {
                    out.push(`${s.id}: transition points to missing state "${c.target.stateId}"`);
                }
            }
        }
    }

    return out;
}
