/**
 * Generic wire-byte-order layout builder shared by every Infinity Engine effect record - the EFF v2 body
 * (264 bytes), the EFF v1 body (48 bytes), and the ITM/SPL feature block (48 bytes). All three render the same
 * way: a dense, untitled layout that lists every user field in on-disk (wire) byte order. The records carry
 * different fields, so each passes its own ordered field list - but the layout is this one builder, not a
 * per-record fragment. See the binary-editor uniform-shared-layout principle.
 *
 * Compactness: plain fields render in two columns across the full width (the effect's wide L-tier controls -
 * the opcode combobox, timing dropdown, variable name - need a full-width grid). A bitfield or labelled
 * subgroup renders as its own content-width box at its byte position, NOT a full-width band - so it hugs its
 * content instead of stretching across the row, and consecutive boxes (no plain-field run between them) pack
 * side by side into one wrapping row. Numeric tuples that read as one value (dice in `<thrown>d<sides>`
 * notation, the `probability2 - probability1` range) fold into one labelled cell via `joins`. Field runs and
 * box rows alternate in byte order, top to bottom.
 */

import type { DetailBlock, DetailPanel, DetailRow } from "../layout-schema-types";

/** An ordered effect field, one of:
 *  - a plain field key;
 *  - `{ flags: key, columns? }` for a bitfield to render as a flag box (only fields that carry a flag table -
 *    e.g. EFF v2 / feature-block `saveType`, `resistance` - are marked; a record whose same-named field is a
 *    plain value, like EFF v1 `resistance`, passes it as a plain key). `columns` sets the checkbox column count
 *    (default 2);
 *  - `{ group }` for a labelled boxed subgroup of related fields (e.g. the EFF v2 caster/target Coordinates). */
export type EffectLayoutField =
    | string
    | { readonly flags: string; readonly columns?: number }
    | { readonly group: EffectGroup };

/** A labelled boxed subgroup of related fields, rendered as its own content-width box (like a flag box) at its
 *  byte position. `fields` are in byte order; `joins` fold tuples within the group; `columns` lays the group's
 *  rows out in N columns (default 1). Keys are bare (the builder prefixes them). */
export interface EffectGroup {
    readonly label: string;
    readonly fields: readonly string[];
    readonly joins?: readonly EffectJoin[];
    readonly columns?: number;
}

/** Fold a run of numeric fields into one labelled inline cell ("Label  a sep b"). `fields` is the DISPLAY
 *  order (e.g. `["probability2", "probability1"]` to read low-to-high), which may differ from byte order; all
 *  of them must sit in one field run (no flag between them). Keys are bare (the builder prefixes them). */
export interface EffectJoin {
    readonly label: string;
    readonly fields: readonly string[];
    readonly separator: string;
}

/** Fixed label-column width (ch) for every effect-body fields run. Stops the value columns jumping when the
 *  opcode overlay rewrites the parameter labels; wide enough for the common longest label ("Statistic Modifier"
 *  / "Stacking ID (ToBEx)"), with a rare longer opcode label wrapping rather than reflowing the columns. */
const EFFECT_LABEL_WIDTH_CH = 17;

/** The dice tuple, shown in dice notation `<thrown>d<sides>` (e.g. 1d6, 2d12), shared by the EFF v1/v2 bodies;
 *  the feature block has no dice. */
export const DICE_JOIN: EffectJoin = { label: "Dice", fields: ["diceThrown", "diceSides"], separator: "d" };
/** The probability range, shown low-to-high as `probability2 - probability1`. Present in every effect record. */
export const PROBABILITY_JOIN: EffectJoin = {
    label: "Probability",
    fields: ["probability2", "probability1"],
    separator: " - ",
};

/**
 * Build the detail rows for an effect record. A run of plain fields becomes one full-width 2-column panel;
 * each bitfield (`{ flags }`) and each labelled subgroup (`{ group }`) becomes its own content-width (`fit`)
 * box at its byte position - so it hugs its content rather than claiming a full-width row. Each join in
 * `joins` folds its fields into one cell within whichever run holds them all (a group carries its own joins).
 * `prefix` is the record's semantic-key field-ref prefix (e.g. `eff.body`, `itm.effects[]`, `cre.effects[].v2`).
 */
export function effectBodyRows(
    prefix: string,
    fields: readonly EffectLayoutField[],
    joins: readonly EffectJoin[] = [],
): DetailRow[] {
    const k = (key: string): string => `${prefix}.${key}`;
    const prefixJoins = (js: readonly EffectJoin[]): { label: string; fields: string[]; separator: string }[] =>
        js.map((j) => ({ label: j.label, fields: j.fields.map((f) => k(f)), separator: j.separator }));
    const rows: DetailRow[] = [];
    let run: string[] = [];
    // Consecutive boxes (flag/group, no plain-field run between them) pack side by side into one wrapping row.
    let boxes: DetailPanel[] = [];
    const flushRun = (): void => {
        if (run.length === 0) return;
        const runSet = new Set(run);
        // A join belongs to this run iff every field it folds sits in it (so a flag splitting the run, as in the
        // feature block, routes each join to the correct side).
        const runJoins = prefixJoins(joins.filter((j) => j.fields.every((f) => runSet.has(f))));
        const block: DetailBlock = {
            kind: "fields",
            columns: 2,
            fields: run.map((key) => k(key)),
            // Fixed label column: the opcode overlay rewrites parameter1/parameter2 labels per opcode, so a
            // max-content label track would resize - and the value columns jump - on every opcode change. A
            // fixed width keeps them put. Sized for the common longest effect label; the rare longer opcode
            // label wraps instead of shifting the columns.
            labelWidthCh: EFFECT_LABEL_WIDTH_CH,
            ...(runJoins.length > 0 && { joins: runJoins }),
        };
        rows.push({ panels: [{ blocks: [block] }] });
        run = [];
    };
    const flushBoxes = (): void => {
        if (boxes.length === 0) return;
        rows.push({ panels: boxes });
        boxes = [];
    };
    for (const field of fields) {
        if (typeof field === "string") {
            flushBoxes();
            run.push(field);
            continue;
        }
        flushRun();
        const block: DetailBlock =
            "flags" in field
                ? { kind: "flags", field: k(field.flags), columns: field.columns ?? 2 }
                : {
                      kind: "group",
                      label: field.group.label,
                      fields: field.group.fields.map((f) => k(f)),
                      columns: field.group.columns ?? 1,
                      ...(field.group.joins && { joins: prefixJoins(field.group.joins) }),
                  };
        boxes.push({ fit: true, blocks: [block] });
    }
    flushRun();
    flushBoxes();
    return rows;
}
