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

/** Emit a complete BAF script */
export function emitBAF(script: BAFScript): string {
    const fileName = path.basename(script.sourceFile);
    const traLine = script.traTag ? `/** @tra ${script.traTag} */\n` : "";
    let output = `${traLine}/* Do not edit. This file is generated from ${fileName}. Make your changes there and regenerate this file. */\n\n`;

    for (const block of script.blocks) {
        output += emitBlock(block);
        output += "\n";
    }

    return output.trimEnd() + "\n";
}

/** Emit a single IF/THEN/END block */
function emitBlock(block: BAFBlock): string {
    let result = "IF\n";

    for (const cond of block.conditions) {
        result += emitCondition(cond);
    }

    result += "THEN\n";
    result += `  RESPONSE #${block.response}\n`;

    for (const action of block.actions) {
        result += emitAction(action);
    }

    result += "END\n";
    return result;
}

/** Emit a top-level condition (single or OR group) */
function emitCondition(cond: BAFTopCondition): string {
    if (isOrGroup(cond)) {
        let result = `  OR(${cond.conditions.length})\n`;
        for (const c of cond.conditions) {
            result += `    ${emitSingleCondition(c)}\n`;
        }
        return result;
    } else {
        return `  ${emitSingleCondition(cond)}\n`;
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
