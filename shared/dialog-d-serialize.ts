/**
 * Serialize a format-neutral DialogModel back to WeiDU D source text.
 * Inverse of the modelFromD adapter in dialog-model.ts.
 */

import type { DialogChoice, DialogModel, DialogRoot, DialogState, DialogTarget } from "./dialog-model";

/**
 * Emit WeiDU D source text from a DialogModel.
 *
 * Only weidu-d models are serializable; any other format throws. Patch roots
 * (ALTER_TRANS, REPLACE_TRANS_TRIGGER, etc.) are skipped in v1 because the IR
 * does not carry their detail - only dialog roots with states are emitted.
 * TODO: serialize patch roots when the IR gains ALTER_TRANS/REPLACE detail.
 *
 * The emitted form uses APPEND blocks (not BEGIN) so the output is always safe
 * to layer on top of an existing dialog file. The caller is responsible for
 * choosing BEGIN vs APPEND if the distinction matters for the target use case.
 */
export function modelToD(model: DialogModel): string {
    if (model.format !== "weidu-d") {
        throw new Error("modelToD: only weidu-d is serializable");
    }

    const dialogRoots = model.roots.filter((r) => r.kind === "dialog");
    if (dialogRoots.length === 0) {
        return "";
    }

    return dialogRoots.map((root) => serializeRoot(root)).join("\n");
}

function serializeRoot(root: DialogRoot): string {
    const lines: string[] = [`APPEND ~${root.label}~`];
    for (const state of root.states) {
        lines.push(...serializeState(state));
    }
    lines.push("END");
    return lines.join("\n");
}

/**
 * A bare translation/string reference token - `@N` (tra_ref) or `#N` (tlk_ref) -
 * is written WITHOUT tilde delimiters: WeiDU resolves `@20` against the `.tra`,
 * whereas `~@20~` is the literal four-character string. Any other value is a
 * literal and is tilde-wrapped.
 *
 * Note the irreducible ambiguity at this layer: the model stores both a real
 * `@20` ref and a literal `~@20~` string as the same `"@20"` text (the parser
 * dropped the distinction), so this heuristic emits the ref form for `@N`/`#N`.
 * That is correct for the overwhelmingly common case (real refs); a literal whose
 * content happens to be `@20` is the rare loss the per-field/typed-ref design would
 * close. The locality skip keeps this from mattering for any state left unedited.
 */
const REF_TOKEN = /^[@#]\d+$/;

export function serializeTextValue(text: string): string {
    return REF_TOKEN.test(text) ? text : `~${text}~`;
}

export function serializeState(state: DialogState): string[] {
    const lines: string[] = [];

    // Build the IF header: optional WEIGHT, trigger, state id
    const weight = state.weight != null ? `WEIGHT #${state.weight} ` : "";
    const trigger = state.trigger ?? "";
    lines.push(`  IF ${weight}~${trigger}~ THEN BEGIN ${state.id}`);
    lines.push(`    SAY ${serializeTextValue(state.text)}`);

    for (const choice of state.choices) {
        lines.push(`    ${serializeChoice(choice)}`);
    }

    lines.push("  END");
    return lines;
}

export function serializeChoice(choice: DialogChoice): string {
    const parts: string[] = [];

    if (choice.text != null) {
        // Reply transition -> the corpus `+ [~cond~] + reply [DO ~..~] next` shorthand
        // (`++` when unconditional, `+ label` for a goto). This is how `.d` mods
        // overwhelmingly write replies, so an edited reply re-emits in the shorthand its
        // siblings use. The trigger sits inline between the two `+` markers; the weidu-d
        // parser reads it back from a transition_short (see parseTransitionShort), so the
        // condition round-trips.
        const cond = choice.condition ?? "";
        parts.push(cond === "" ? "++" : `+ ~${cond}~ +`);
        parts.push(serializeTextValue(choice.text));
        if (choice.action != null) {
            parts.push(`DO ~${choice.action}~`);
        }
        parts.push(serializeNextShort(choice.target));
        return parts.join(" ");
    }

    // No reply text -> a bare transition (direct goto/call/exit). Verbose IF/THEN form,
    // no REPLY keyword.
    const condition = choice.condition ?? "";
    parts.push(`IF ~${condition}~ THEN`);
    if (choice.action != null) {
        parts.push(`DO ~${choice.action}~`);
    }
    parts.push(serializeTarget(choice.target));

    return parts.join(" ");
}

/**
 * The "next" clause of a `transition_short`: a state goto uses the `+ label`
 * short_goto form (not verbose `GOTO label`); EXIT and external targets reuse the
 * shared target serializer (`EXIT` / `EXTERN ~file~ state` / `COPY_TRANS ...`).
 */
function serializeNextShort(target: DialogTarget): string {
    if (target.kind === "state") return `+ ${target.stateId}`;
    return serializeTarget(target);
}

/**
 * Strip leading and trailing tilde delimiters from a WeiDU string value when
 * the tree-sitter node text includes them. The parser stores raw `.text` from
 * tilde_string nodes (e.g. "~otherdlg~"), so label fields in the IR may carry
 * the delimiters. We normalise before re-wrapping in the emitted ~ ~ pair.
 */
function stripTildes(s: string): string {
    if (s.startsWith("~") && s.endsWith("~") && s.length >= 2) {
        return s.slice(1, -1);
    }
    return s;
}

function serializeTarget(target: DialogTarget): string {
    switch (target.kind) {
        case "state":
            return `GOTO ${target.stateId}`;
        case "exit":
            return "EXIT";
        case "external": {
            // COPY_TRANS targets are encoded as `external` with label starting "COPY_TRANS ".
            // Regular EXTERN targets are encoded as "file:state".
            if (target.label.startsWith("COPY_TRANS ")) {
                // Strip the sentinel prefix, then split on the first colon.
                const rest = target.label.slice("COPY_TRANS ".length);
                const colon = rest.indexOf(":");
                if (colon === -1) {
                    // Malformed: no colon separator - emit as best-effort
                    return `COPY_TRANS ~${stripTildes(rest)}~`;
                }
                const file = stripTildes(rest.slice(0, colon));
                const stateId = rest.slice(colon + 1);
                return `COPY_TRANS ~${file}~ ${stateId}`;
            }
            // Regular extern: "file:state" (file may have tilde delimiters from the parser)
            const colon = target.label.indexOf(":");
            if (colon === -1) {
                return `EXTERN ~${stripTildes(target.label)}~`;
            }
            const file = stripTildes(target.label.slice(0, colon));
            const stateId = target.label.slice(colon + 1);
            return `EXTERN ~${file}~ ${stateId}`;
        }
    }
}
