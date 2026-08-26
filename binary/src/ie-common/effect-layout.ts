/**
 * Generic wire-byte-order layout builder shared by both Infinity Engine effect records - the EFF v2 body
 * (264 bytes) and the 48-byte feature block (the same record IESDP documents as both the ITM/SPL feature block
 * and EFF v1, embedded in ITM/SPL and in a CRE's effStructureVersion-0 effects). Both render the same way: a
 * dense, untitled layout that lists every user field in on-disk (wire) byte order. The records carry different
 * fields, so each passes its own ordered field list - but the layout is this one builder, not a per-record
 * fragment. See the binary-editor uniform-shared-layout principle.
 *
 * Compactness: plain fields render in two columns across the full width (the effect's wide L-tier controls -
 * the opcode combobox, timing dropdown, variable name - need a full-width grid). A bitfield or labelled
 * subgroup renders as its own content-width box at its byte position, NOT a full-width band - so it hugs its
 * content instead of stretching across the row, and consecutive boxes (no plain-field run between them) pack
 * side by side into one wrapping row. A numeric tuple that reads as one value (the `probability2 - probability1`
 * range) folds into one labelled cell via `joins`. Field runs and box rows alternate in byte order, top to
 * bottom.
 */

import type { DetailBlock, DetailPanel, DetailRow } from "../layout-schema-types";

/** An ordered effect field, one of:
 *  - a plain field key;
 *  - `{ flags: key, columns? }` for a bitfield to render as a flag box (fields that carry a flag table -
 *    `saveType` / `resistance` on both the EFF v2 body and the feature block - are marked). `columns` sets the
 *    checkbox column count (default 2);
 *  - `{ group }` for a labelled boxed subgroup of related fields (e.g. the EFF v2 caster/target Coordinates). */
export type EffectLayoutField =
    | string
    | { readonly flags: string; readonly columns?: number }
    | { readonly group: EffectGroup };

/** A member of an `EffectGroup`: a plain field key, or `{ flags: key, columns? }` for a bitfield that renders
 *  as a flag-checkbox box INSIDE the group's legend box (e.g. Parent Resource Flags). */
export type EffectGroupField = string | { readonly flags: string; readonly columns?: number };

/** A labelled boxed subgroup of related fields, rendered as its own content-width box (like a flag box) at its
 *  byte position. `fields` are in byte order; a `{ flags }` member renders as a flag-checkbox box inside the
 *  same legend box (its plain siblings stay a fields block above it). `joins` fold tuples within the group;
 *  `columns` lays the group's plain rows out in N columns (default 1). Keys are bare (the builder prefixes
 *  them). */
export interface EffectGroup {
    readonly label: string;
    readonly fields: readonly EffectGroupField[];
    readonly joins?: readonly EffectJoin[];
    readonly columns?: number;
}

/** Fold a run of numeric fields into one labelled inline cell ("Label  a sep b"). `fields` is the DISPLAY
 *  order (e.g. `["probability2", "probability1"]` to read low-to-high), which may differ from byte order; all
 *  of them must sit in one field run (no flag between them). Keys are bare (the builder prefixes them). */
export interface EffectJoin {
    readonly label: string;
    readonly fields: readonly string[];
    /** One string between every pair, or an array of (fields.length - 1) per-gap separators (e.g. `["d", "+"]`). */
    readonly separator: string | string[];
}

/** Per-field reserved label width (ch) for fields the opcode overlay RELABELS at runtime, so the column holding
 *  one stops its value jumping as the label changes; every other column hugs its static label. Keys are bare
 *  (matched against the run's bare field keys). parameter1/parameter2 swap to labels up to "Statistic Modifier"
 *  (18ch); the dual-purpose 0x1c/0x20 pair swaps between "Maximum Level"/"Minimum Level" (13ch) and "Dice
 *  Thrown"/"Dice Sides", named maxLevel/minLevel in the feature block and diceThrown/diceSides in the EFF body.
 *  Each reserved field keeps its own width; the renderer floors a column to the max width among ITS reserved
 *  fields, so in the EFF run where parameters (col 1) and the dice/level pair (col 2) share a block, col 1
 *  floors to 18 and col 2 to 13 independently - the pair never inherits the wider parameter reserve. A rarer
 *  label longer than its width grows that one column rather than shifting the static columns. */
const MUTABLE_LABEL_RESERVE_CH: Readonly<Record<string, number>> = {
    parameter1: 18,
    parameter2: 18,
    maxLevel: 13,
    minLevel: 13,
    diceThrown: 13,
    diceSides: 13,
    // The EE-era slots the overlay also relabels. Sized to the labels these actually take across IESDP
    // ("Frequency Multiplier", "Selection circle color"); the 46-char outlier on parameter3/parameter5 grows
    // its own column, which is what a reserve is a floor for rather than a cap.
    //
    // `power` is deliberately absent though the overlay relabels it too: one opcode of 442 does so, and it
    // shares the header run with Opcode/Target, so reserving would pad those static labels on every record.
    parameter3: 20,
    parameter4: 20,
    parameter5: 20,
    stackingIdEx: 18,
    stackingIdTobex: 18,
};

/** The probability range, shown low-to-high as `probability2 - probability1`. Present in every effect record. */
export const PROBABILITY_JOIN: EffectJoin = {
    label: "Probability",
    fields: ["probability2", "probability1"],
    separator: " - ",
};

/**
 * Build the detail rows for an effect record.
 *
 * Fields stay in ON-DISK BYTE ORDER, matching the spec, and the panel carries NO semantic titles - do not
 * regroup by meaning or add headings. The record is read against a byte layout, so its order is the useful
 * one; the foldings and boxes below are the only structure imposed on it, and each is deliberate.
 *
 * A run of plain fields becomes one full-width 2-column panel;
 * each bitfield (`{ flags }`) and each labelled subgroup (`{ group }`) becomes its own content-width (`fit`)
 * box at its byte position - so it hugs its content rather than claiming a full-width row. Each join in
 * `joins` folds its fields into one cell within whichever run holds them all (a group carries its own joins).
 * `prefix` is the record's semantic-key field-ref prefix (e.g. `eff.body`, `itm.effects[]`, `cre.effects[].v2`).
 */
export function effectBodyRows(
    prefix: string,
    fields: readonly EffectLayoutField[],
    joins: readonly EffectJoin[] = [],
    // Plain-field-run column count. The wide EFF v2 body (long variable name, coordinates) keeps 2; the small
    // 48-byte feature block passes 3 to pack its scalar runs tightly and fill the detail width.
    columns = 2,
): DetailRow[] {
    const k = (key: string): string => `${prefix}.${key}`;
    const prefixJoins = (
        js: readonly EffectJoin[],
    ): { label: string; fields: string[]; separator: string | string[] }[] =>
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
        // Reserve a label width ONLY for the runtime-relabeled fields (parameter1/parameter2 and the
        // dice/level pair) that sit in this run, so the column holding them stops the value jumping when the
        // opcode relabels them - while the static columns beside it (Opcode/Target/Power) hug their short
        // labels at `max-content`. The run's reserve is the max over its relabeled fields; a run with none
        // reserves nothing (every column max-content).
        const reservedKeys = run.filter((key) => key in MUTABLE_LABEL_RESERVE_CH);
        const block: DetailBlock = {
            kind: "fields",
            columns,
            fields: run.map((key) => k(key)),
            ...(reservedKeys.length > 0 && {
                labelReserve: {
                    fields: reservedKeys.map((key) => ({ ref: k(key), ch: MUTABLE_LABEL_RESERVE_CH[key]! })),
                },
            }),
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
        let block: DetailBlock;
        if ("flags" in field) {
            block = { kind: "flags", field: k(field.flags), columns: field.columns ?? 2 };
        } else {
            // Split a group's plain field keys from an optional `{ flags }` member: the plain keys stay the
            // group's fields block; the flags member renders as a flag box inside the same legend box.
            const plainKeys = field.group.fields.filter((f): f is string => typeof f === "string");
            const flagMember = field.group.fields.find(
                (f): f is { readonly flags: string; readonly columns?: number } => typeof f !== "string",
            );
            block = {
                kind: "group",
                label: field.group.label,
                fields: plainKeys.map((f) => k(f)),
                columns: field.group.columns ?? 1,
                ...(field.group.joins && { joins: prefixJoins(field.group.joins) }),
                ...(flagMember && {
                    flagsField: k(flagMember.flags),
                    ...(flagMember.columns !== undefined && { flagsColumns: flagMember.columns }),
                }),
            };
        }
        boxes.push({ fit: true, blocks: [block] });
    }
    flushRun();
    flushBoxes();
    return rows;
}
