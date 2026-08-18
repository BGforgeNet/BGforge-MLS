/**
 * BAF Emitter
 *
 * Converts BAF IR to BAF text format.
 */

import * as path from "path";
import {
    type BAFAction,
    type BAFBlock,
    type BAFCondition,
    type BAFScript,
    type BAFTopCondition,
    isOrGroup,
} from "./ir";
import { makeGeneratedHeader } from "../../common/transpiler-utils";
import { TrackedText, type LineOrigin } from "../../common/tracked-text";

/** Emitted BAF, and the bundled line each of its lines came from. */
export interface EmittedBAF {
    text: string;
    origins: readonly LineOrigin[];
}

/**
 * Emit a complete BAF script.
 *
 * Each emitted line is attributed as it is written, because after this the correspondence is gone: the
 * output is flat IF/THEN/END blocks with nothing left to tie them to the statements they came from.
 */
export function emitBAF(script: BAFScript): EmittedBAF {
    const fileName = path.basename(script.sourceFile);
    const out = new TrackedText();
    out.add(makeGeneratedHeader(fileName, script.traTag));

    for (const block of script.blocks) {
        emitBlock(out, block);
        out.add("\n", block.line);
    }

    // Trailing blank lines are trimmed, so the origins for the lines they occupied go with them.
    const text = out.text.trimEnd() + "\n";
    const lineCount = text.split("\n").length - 1;
    return { text, origins: out.origins.slice(0, lineCount) };
}

/** Emit a single IF/THEN/END block */
function emitBlock(out: TrackedText, block: BAFBlock): void {
    out.add("IF\n", block.line);

    for (const cond of block.conditions) {
        emitCondition(out, cond, block.line);
    }

    out.add("THEN\n", block.line);
    out.add(`  RESPONSE #${block.response}\n`, block.line);

    for (const action of block.actions) {
        out.add(emitAction(action), action.line ?? block.line);
    }

    out.add("END\n", block.line);
}

/** Emit a top-level condition (single or OR group) */
function emitCondition(out: TrackedText, cond: BAFTopCondition, blockLine: LineOrigin): void {
    if (isOrGroup(cond)) {
        // The group itself came from wherever the block did; each alternative keeps its own line.
        out.add(`  OR(${cond.conditions.length})\n`, blockLine);
        for (const c of cond.conditions) {
            out.add(`    ${emitSingleCondition(c)}\n`, c.line ?? blockLine);
        }
    } else {
        out.add(`  ${emitSingleCondition(cond)}\n`, cond.line ?? blockLine);
    }
}

/** Emit a single condition like See(Player1) or !Global("x", "LOCALS", 0) */
function emitSingleCondition(cond: BAFCondition): string {
    const prefix = cond.negated ? "!" : "";
    const args = cond.args.join(", ");
    return `${prefix}${cond.name}(${args})`;
}

/** Emit an action like Spell(Myself, WIZARD_SHIELD) */
function emitAction(action: BAFAction): string {
    const args = action.args.join(", ");
    let result = `    ${action.name}(${args})`;
    if (action.comment) {
        result += ` // ${action.comment}`;
    }
    return result + "\n";
}
