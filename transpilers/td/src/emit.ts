/**
 * TD Emitter - converts IR to WeiDU D code
 *
 * Takes a TDScript IR and produces formatted D text output.
 */

import * as path from "path";
import { applyHelperFixups } from "../../common/transpiler-utils";
import {
    type TDScript,
    type TDConstruct,
    type TDBegin,
    type TDAppend,
    type TDExtend,
    type TDChain,
    type TDState,
    type TDText,
    type TDTransition,
    type TDTransitionNext,
    type TDChainEpilogue,
    type TDInterject,
    TDConstructType,
    TDTextType,
    TDTransitionType,
    TDEpilogueType,
    TDPatchOp,
} from "./types";

const INDENT = "    ";

/**
 * Emit a complete TD script as D code.
 */
export function emitD(script: TDScript): string {
    const filename = path.basename(script.sourceFile);
    const traLine = script.traTag ? `/** @tra ${script.traTag} */\n` : "";
    const header = `${traLine}/* Generated from ${filename} - do not edit */\n\n`;
    const body = script.constructs.map(emitConstruct).join("\n\n");
    return header + body + "\n";
}

/**
 * Emit a top-level construct.
 */
function emitConstruct(construct: TDConstruct): string {
    switch (construct.type) {
        case TDConstructType.Begin:
            return emitBegin(construct);
        case TDConstructType.Append:
            return emitAppend(construct);
        case TDConstructType.ExtendTop:
        case TDConstructType.ExtendBottom:
            return emitExtend(construct);
        case TDConstructType.Chain:
            return emitChain(construct);
        case TDConstructType.Interject:
        case TDConstructType.InterjectCopyTrans:
        case TDConstructType.InterjectCopyTrans2:
            return emitInterject(construct);
        case TDConstructType.Patch:
            return emitPatch(construct);
        default: {
            // Exhaustive check: all TDConstructType values must be handled above
            const _exhaustive: never = construct;
            throw new Error(`Unknown construct type: ${(_exhaustive as TDConstruct).type}`);
        }
    }
}

// =============================================================================
// BEGIN / APPEND
// =============================================================================

function emitBegin(begin: TDBegin): string {
    const nonPausing = begin.nonPausing ? " 1" : "";
    const header = `BEGIN ${begin.filename}${nonPausing}\n`;
    const states = begin.states.map(emitState).join("\n\n");
    return header + "\n" + states;
}

function emitAppend(append: TDAppend): string {
    const keyword = append.early ? "APPEND_EARLY" : "APPEND";
    const ifExists = append.ifFileExists ? "IF_FILE_EXISTS " : "";
    const header = `${keyword} ${ifExists}${append.filename}\n`;
    const states = append.states.map((s) => indentBlock(emitState(s))).join("\n\n");
    return header + states + "\nEND";
}

/**
 * Indent every line of a block by one level.
 */
function indentBlock(block: string): string {
    return block
        .split("\n")
        .map((line) => INDENT + line)
        .join("\n");
}

// =============================================================================
// State
// =============================================================================

function emitState(state: TDState): string {
    const lines: string[] = [];

    // State header: IF ~trigger~ label or IF ~~ label
    const trigger = applyHelperFixups(state.trigger ?? "");
    const weight = state.weight !== undefined ? `WEIGHT #${state.weight} ` : "";
    lines.push(`IF ${weight}~${trigger}~ ${state.label}`);

    // SAY - with multisay support: SAY text = text = text
    // States with transitions but no say() emit SAY ~~ (required WeiDU syntax).
    if (state.say.length > 0) {
        const sayTexts = state.say.map((s) => emitText(s.text));
        lines.push(`    SAY ${sayTexts.join(" = ")}`);
    } else if (state.transitions.length > 0) {
        lines.push(`    SAY ~~`);
    }

    // Transitions
    for (const trans of state.transitions) {
        lines.push(emitTransition(trans));
    }

    lines.push("END");
    return lines.join("\n");
}

// =============================================================================
// Transition
// =============================================================================

function emitTransition(trans: TDTransition): string {
    const hasTrigger = trans.trigger !== undefined && trans.trigger !== "";
    const hasReply = trans.reply !== undefined;

    // Without reply, use full format: IF ~trigger~ THEN GOTO target
    // With reply, use shorthand: +~trigger~+ @text + target
    if (!hasReply) {
        return emitTransitionLongform(trans, hasTrigger);
    }

    let result = INDENT;

    // Trigger part: +~trigger~+ or ++
    if (hasTrigger) {
        result += `+~${applyHelperFixups(trans.trigger!)}~+`;
    } else {
        result += "++";
    }

    // Reply text (guaranteed to exist after hasReply check above)
    result += " " + emitText(trans.reply!);

    // DO action
    if (trans.action) {
        result += ` DO ~${applyHelperFixups(trans.action)}~`;
    }

    // Journal entries
    if (trans.journal) {
        result += ` JOURNAL ${emitText(trans.journal)}`;
    }
    if (trans.solvedJournal) {
        result += ` SOLVED_JOURNAL ${emitText(trans.solvedJournal)}`;
    }
    if (trans.unsolvedJournal) {
        result += ` UNSOLVED_JOURNAL ${emitText(trans.unsolvedJournal)}`;
    }

    // Flags
    if (trans.flags !== undefined) {
        result += ` FLAGS ${trans.flags}`;
    }

    // Next: + target for shorthand
    result += " " + emitTransitionNextShorthand(trans.next);

    return result;
}

/**
 * Emit transition in long form: IF ~trigger~ THEN [DO ~action~] GOTO target
 * Used when there's no reply text.
 *
 * COPY_TRANS/COPY_TRANS_LATE are emitted directly (not wrapped in IF~THEN)
 * because the WeiDU D grammar treats them as state-level constructs.
 */
function emitTransitionLongform(trans: TDTransition, hasTrigger: boolean): string {
    // COPY_TRANS is a state-level terminal, not an IF~THEN transition
    if (trans.next.type === TDTransitionType.CopyTrans) {
        return INDENT + emitTransitionNext(trans.next);
    }

    let result = INDENT + "IF ~";
    result += hasTrigger ? applyHelperFixups(trans.trigger!) : "";
    result += "~";

    if (trans.action) {
        result += ` DO ~${applyHelperFixups(trans.action)}~`;
    }

    result += " " + emitTransitionNext(trans.next);
    return result;
}

function emitTransitionNextShorthand(next: TDTransitionNext): string {
    switch (next.type) {
        case TDTransitionType.Goto:
            return `+ ${next.target}`;
        case TDTransitionType.Exit:
            return "EXIT";
        case TDTransitionType.Extern: {
            const ifExists = next.ifFileExists ? "IF_FILE_EXISTS " : "";
            return `EXTERN ${ifExists}${next.filename} ${next.target}`;
        }
        case TDTransitionType.CopyTrans: {
            const safe = next.safe ? "SAFE " : "";
            const keyword = next.late ? "COPY_TRANS_LATE" : "COPY_TRANS";
            return `${keyword} ${safe}${next.filename} ${next.target}`;
        }
    }
}

function emitTransitionNext(next: TDTransitionNext): string {
    switch (next.type) {
        case TDTransitionType.Goto:
            return `GOTO ${next.target}`;
        case TDTransitionType.Exit:
            return "EXIT";
        case TDTransitionType.Extern: {
            const ifExists = next.ifFileExists ? "IF_FILE_EXISTS " : "";
            return `EXTERN ${ifExists}${next.filename} ${next.target}`;
        }
        case TDTransitionType.CopyTrans: {
            const safe = next.safe ? "SAFE " : "";
            const keyword = next.late ? "COPY_TRANS_LATE" : "COPY_TRANS";
            return `${keyword} ${safe}${next.filename} ${next.target}`;
        }
    }
}

// =============================================================================
// Text
// =============================================================================

function emitText(text: TDText): string {
    // Handle male/female variants
    if (text.male && text.female) {
        return `${emitText(text.male)} ${emitText(text.female)}`;
    }

    let result: string;
    switch (text.type) {
        case TDTextType.Tra:
            result = `@${text.value}`;
            break;
        case TDTextType.Tlk:
            result = `#${text.value}`;
            break;
        case TDTextType.Literal:
            result = `~${text.value}~`;
            break;
        case TDTextType.Forced:
            result = `!${text.value}`;
            break;
        default: {
            // Exhaustive check: all TDTextType values must be handled above
            const _exhaustive: never = text.type;
            throw new Error(`Unknown text type: ${_exhaustive}`);
        }
    }

    // Add sound if present
    if (text.sound) {
        result += ` [${text.sound}]`;
    }

    return result;
}

// =============================================================================
// EXTEND
// =============================================================================

function emitExtend(extend: TDExtend): string {
    const keyword = extend.type === TDConstructType.ExtendTop ? "EXTEND_TOP" : "EXTEND_BOTTOM";
    const position = extend.position !== undefined ? ` #${extend.position}` : "";

    const lines: string[] = [];
    lines.push(`${keyword} ${extend.filename} ${extend.stateLabel}${position}`);

    for (const trans of extend.transitions) {
        lines.push(emitTransition(trans));
    }

    lines.push("END");
    return lines.join("\n");
}

// =============================================================================
// CHAIN
// =============================================================================

function emitChain(chain: TDChain): string {
    const lines: string[] = [];

    // CHAIN header
    lines.push("CHAIN");

    // IF trigger THEN filename label
    if (chain.trigger) {
        const weight = chain.weight !== undefined ? `WEIGHT #${chain.weight} ` : "";
        lines.push(`IF ${weight}~${applyHelperFixups(chain.trigger)}~ THEN ${chain.filename} ${chain.label}`);
    } else {
        lines.push(`${chain.filename} ${chain.label}`);
    }

    // First entry text (initial speaker)
    let currentSpeaker = chain.filename;
    let firstEntry = true;

    for (const entry of chain.entries) {
        // Speaker switch needed if different speaker (but not for first entry)
        if (entry.speaker && entry.speaker !== currentSpeaker && !firstEntry) {
            // Speaker switch
            const ifCond = entry.trigger ? ` IF ~${applyHelperFixups(entry.trigger)}~ THEN` : "";
            const ifExists = entry.ifFileExists ? "IF_FILE_EXISTS " : "";
            lines.push(`== ${ifExists}${entry.speaker}${ifCond}`);
            currentSpeaker = entry.speaker;
        } else if (!firstEntry && entry.trigger) {
            // Same speaker with condition
            lines.push(`= IF ~${applyHelperFixups(entry.trigger)}~ THEN`);
        }

        // Update current speaker if this is first entry
        if (firstEntry && entry.speaker) {
            currentSpeaker = entry.speaker;
        }

        // Emit texts (multisay within entry)
        for (let i = 0; i < entry.texts.length; i++) {
            const text = entry.texts[i];
            if (!text) continue;
            if (i === 0 && firstEntry) {
                // First text of chain - no prefix
                lines.push(emitText(text));
            } else if (i === 0) {
                // First text after speaker switch - no = prefix (already on == line)
                lines.push(emitText(text));
            } else {
                // Continuation - use = for multisay
                lines.push(`= ${emitText(text)}`);
            }
        }

        // Action after entry
        if (entry.action) {
            lines.push(`DO ~${applyHelperFixups(entry.action)}~`);
        }

        firstEntry = false;
    }

    // Epilogue
    lines.push(emitChainEpilogue(chain.epilogue));

    return lines.join("\n");
}

function emitChainEpilogue(epilogue: TDChainEpilogue): string {
    switch (epilogue.type) {
        case TDEpilogueType.Exit:
            return "EXIT";
        case TDEpilogueType.End:
            return `END ${epilogue.filename} ${epilogue.target}`;
        case TDEpilogueType.CopyTrans: {
            const safe = epilogue.safe ? "SAFE " : "";
            const keyword = epilogue.late ? "COPY_TRANS_LATE" : "COPY_TRANS";
            return `${keyword} ${safe}${epilogue.filename} ${epilogue.target}`;
        }
        case TDEpilogueType.Transitions:
            return "END\n" + epilogue.transitions.map(emitTransition).join("\n");
    }
}

// =============================================================================
// INTERJECT
// =============================================================================

function emitInterject(interject: TDChain | TDInterject): string {
    // Type narrowing
    if (interject.type === TDConstructType.Chain) {
        return emitChain(interject);
    }

    const lines: string[] = [];
    const safeFlag = interject.safe ? "SAFE " : "";

    let keyword: string;
    switch (interject.type) {
        case TDConstructType.Interject:
            keyword = "INTERJECT";
            break;
        case TDConstructType.InterjectCopyTrans:
            keyword = "INTERJECT_COPY_TRANS";
            break;
        case TDConstructType.InterjectCopyTrans2:
            keyword = "INTERJECT_COPY_TRANS2";
            break;
    }

    lines.push(`${keyword} ${safeFlag}${interject.filename} ${interject.stateLabel} ${interject.globalVariable}`);

    // Emit entries - INTERJECT always uses == for speakers (even first)
    for (const entry of interject.entries) {
        // Speaker line (INTERJECT always has == prefix, unlike CHAIN)
        if (entry.speaker) {
            const ifCond = entry.trigger ? ` IF ~${applyHelperFixups(entry.trigger)}~ THEN` : "";
            const ifExists = entry.ifFileExists ? "IF_FILE_EXISTS " : "";
            lines.push(`  == ${ifExists}${entry.speaker}${ifCond}`);
        }

        // Emit texts
        for (let j = 0; j < entry.texts.length; j++) {
            const text = entry.texts[j];
            if (!text) continue; // Skip undefined entries
            const prefix = j === 0 ? "    " : "  = ";
            lines.push(`${prefix}${emitText(text)}`);
        }

        // Action after entry
        if (entry.action) {
            lines.push(`  DO ~${applyHelperFixups(entry.action)}~`);
        }
    }

    if (interject.epilogue) {
        lines.push(emitChainEpilogue(interject.epilogue));
    }

    return lines.join("\n");
}

// =============================================================================
// Patch operations
// =============================================================================

function emitPatch(patch: { type: "patch"; operation: import("./types").TDPatchOperation }): string {
    const op = patch.operation;

    switch (op.op) {
        case TDPatchOp.AlterTrans:
            return emitAlterTrans(op);
        case TDPatchOp.AddStateTrigger:
            return `ADD_STATE_TRIGGER ${op.filename} ${formatStateList(op.states)} ~${applyHelperFixups(op.trigger)}~${formatUnless(op.unless)}`;
        case TDPatchOp.AddTransTrigger: {
            const trans = op.transitions ? ` DO ${op.transitions.join(" ")}` : "";
            return `ADD_TRANS_TRIGGER ${op.filename} ${formatStateList(op.states)} ~${applyHelperFixups(op.trigger)}~${trans}${formatUnless(op.unless)}`;
        }
        case TDPatchOp.AddTransAction:
            return `ADD_TRANS_ACTION ${op.filename} BEGIN ${formatStateList(op.states)} END BEGIN ${op.transitions.join(" ")} END ~${applyHelperFixups(op.action)}~${formatUnless(op.unless)}`;
        case TDPatchOp.ReplaceTransTrigger:
        case TDPatchOp.ReplaceTransAction: {
            const keyword = op.op === TDPatchOp.ReplaceTransTrigger ? "REPLACE_TRANS_TRIGGER" : "REPLACE_TRANS_ACTION";
            return `${keyword} ${op.filename} BEGIN ${formatStateList(op.states)} END BEGIN ${op.transitions.join(" ")} END ~${applyHelperFixups(op.oldText)}~ ~${applyHelperFixups(op.newText)}~${formatUnless(op.unless)}`;
        }
        case TDPatchOp.ReplaceTriggerText:
        case TDPatchOp.ReplaceActionText: {
            const keyword = op.op === TDPatchOp.ReplaceTriggerText ? "REPLACE_TRIGGER_TEXT" : "REPLACE_ACTION_TEXT";
            return `${keyword} ${op.filenames.join(" ")} ~${applyHelperFixups(op.oldText)}~ ~${applyHelperFixups(op.newText)}~${formatUnless(op.unless)}`;
        }
        case TDPatchOp.SetWeight:
            return `SET_WEIGHT ${op.filename} ${op.state} #${op.weight}`;
        case TDPatchOp.ReplaceSay:
            return `REPLACE_SAY ${op.filename} ${op.state} ${emitText(op.text)}`;
        case TDPatchOp.ReplaceStateTrigger: {
            // Format: REPLACE_STATE_TRIGGER filename state1 ~trigger~ [state2 state3...] [UNLESS ~condition~]
            const [firstState, ...restStates] = op.states;
            const rest = restStates.length > 0 ? ` ${formatStateList(restStates)}` : "";
            return `REPLACE_STATE_TRIGGER ${op.filename} ${firstState} ~${applyHelperFixups(op.trigger)}~${rest}${formatUnless(op.unless)}`;
        }
        case TDPatchOp.ReplaceStates:
            return emitReplaceStates(op);
    }
}

function emitAlterTrans(op: import("./types").TDAlterTrans): string {
    const lines: string[] = [];
    lines.push(`ALTER_TRANS ${op.filename}`);
    lines.push(`BEGIN ${formatStateList(op.states)} END`);
    lines.push(`BEGIN ${op.transitions.join(" ")} END`);
    lines.push("BEGIN");

    if (op.changes.trigger !== undefined) {
        const triggerValue = op.changes.trigger === false ? "" : applyHelperFixups(op.changes.trigger);
        lines.push(`  "TRIGGER" ~${triggerValue}~`);
    }
    if (op.changes.action !== undefined) {
        lines.push(`  "ACTION" ~${applyHelperFixups(op.changes.action)}~`);
    }
    if (op.changes.reply !== undefined) {
        lines.push(`  "REPLY" ${emitText(op.changes.reply)}`);
    }

    lines.push("END");
    return lines.join("\n");
}

function formatStateList(states: (string | number)[]): string {
    return states.map((s) => (typeof s === "number" ? s.toString() : s)).join(" ");
}

function formatUnless(unless?: string): string {
    return unless ? ` UNLESS ~${unless}~` : "";
}

function emitReplaceStates(op: import("./types").TDReplaceStates): string {
    const lines: string[] = [];
    lines.push(`// REPLACE states in ${op.filename} - manually verify WeiDU syntax`);
    lines.push(`APPEND ${op.filename}`);

    const states = Array.from(op.replacements.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, state]) => indentBlock(emitState(state)));

    lines.push(...states.flatMap((s) => s.split("\n")));
    lines.push("END");

    return lines.join("\n");
}
