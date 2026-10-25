/**
 * Dialog parser for WeiDU D files using tree-sitter.
 * Extracts dialog structure (blocks, states, transitions) for tree visualization.
 *
 * Split into modules:
 * - shared/dialog-types.ts: Data model types (shared with client)
 * - dialog-utils.ts: Text extraction, target resolution, utilities
 * - dialog-modify.ts: Modification block parsers (ALTER_TRANS, etc.)
 * - dialog.ts (this file): Entry point, structural block parsers, state/transition parsers
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { parseWithCache, isInitialized } from "@bgforge/shared/parsers/weidu-d";
import { conlog } from "../logger";
import { SyntaxType } from "./syntax-type";
import type { DDialogBlock, DDialogData, DDialogState, DDialogTransition } from "@bgforge/shared/dialog-types";
import {
    extractSayText,
    extractSayTexts,
    extractSayTextContent,
    extractChainTexts,
    extractChainTextTrigger,
    extractTrigger,
    extractWeight,
    extractTransitionTrigger,
    extractDoAction,
    extractReplyText,
    extractTarget,
    extractTargetLabelRange,
    extractTextContent,
    chainEpilogueTarget,
    getNodeFieldText,
} from "./dialog-utils";
import { labelName } from "./label-refs";
import {
    parseAlterTrans,
    parseAddStateTrigger,
    parseAddTransAction,
    parseAddTransTrigger,
    parseReplaceSay,
    parseReplaceStateTrigger,
    parseReplaceTransAction,
    parseReplaceTransTrigger,
    parseSetWeight,
    parseReplaceText,
} from "./dialog-modify";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse dialog structure from D file text using tree-sitter.
 */
export function parseDDialog(text: string): DDialogData {
    // Both guards deliberately degrade to an empty model so the editor shows a blank dialog rather than throwing
    // the request - but log at warn (operator-visible output channel) so the degrade is diagnosable instead of
    // silently indistinguishable from a genuinely empty file.
    if (!isInitialized()) {
        conlog("parseDDialog: weidu-d parser not initialized; returning empty dialog", "warn");
        return { blocks: [], states: [] };
    }
    const tree = parseWithCache(text);
    if (!tree) {
        conlog("parseDDialog: weidu-d parse produced no tree; returning empty dialog", "warn");
        return { blocks: [], states: [] };
    }

    const blocks: DDialogBlock[] = [];
    const states: DDialogState[] = [];

    for (const child of tree.rootNode.children) {
        switch (child.type) {
            // Structural actions (produce dialog states)
            case SyntaxType.BeginAction:
                parseStateContainer(child, blocks, states, "begin");
                break;
            case SyntaxType.AppendAction:
                parseStateContainer(child, blocks, states, "append");
                break;
            case SyntaxType.ChainAction:
                parseChainAction(child, blocks, states);
                break;
            case SyntaxType.ExtendAction:
                parseExtendAction(child, blocks, states);
                break;
            case SyntaxType.InterjectAction:
            case SyntaxType.InterjectCopyTrans:
                parseInterjectAction(child, blocks, states);
                break;
            case SyntaxType.ReplaceAction:
                parseStateContainer(child, blocks, states, "replace");
                break;

            // Modification actions (patch existing dialogs)
            case SyntaxType.AlterTrans:
                parseAlterTrans(child, blocks);
                break;
            case SyntaxType.AddStateTrigger:
                parseAddStateTrigger(child, blocks);
                break;
            case SyntaxType.AddTransAction:
                parseAddTransAction(child, blocks);
                break;
            case SyntaxType.AddTransTrigger:
                parseAddTransTrigger(child, blocks);
                break;
            case SyntaxType.ReplaceSay:
                parseReplaceSay(child, blocks);
                break;
            case SyntaxType.ReplaceStateTrigger:
                parseReplaceStateTrigger(child, blocks);
                break;
            case SyntaxType.ReplaceTransAction:
                parseReplaceTransAction(child, blocks);
                break;
            case SyntaxType.ReplaceTransTrigger:
                parseReplaceTransTrigger(child, blocks);
                break;
            case SyntaxType.SetWeight:
                parseSetWeight(child, blocks);
                break;
            case SyntaxType.ReplaceActionText:
            case SyntaxType.ReplaceActionTextProcess:
            case SyntaxType.ReplaceActionTextRegexp:
                parseReplaceText(child, blocks, "REPLACE_ACTION_TEXT");
                break;
            case SyntaxType.ReplaceTriggerText:
            case SyntaxType.ReplaceTriggerTextRegexp:
                parseReplaceText(child, blocks, "REPLACE_TRIGGER_TEXT");
                break;
        }
    }

    return { blocks, states };
}

// ---------------------------------------------------------------------------
// Structural block parsers
// ---------------------------------------------------------------------------

/** Shared parser for BEGIN, APPEND, and REPLACE actions (identical structure: block + child states). */
function parseStateContainer(
    node: SyntaxNode,
    blocks: DDialogBlock[],
    states: DDialogState[],
    kind: "begin" | "append" | "replace",
): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    blocks.push({
        kind,
        file,
        line: node.startPosition.row + 1,
    });

    for (const child of node.children) {
        if (child.type === SyntaxType.State) {
            const state = parseState(child, file);
            if (state) {
                states.push(state);
            }
        }
    }
}

function parseChainAction(node: SyntaxNode, blocks: DDialogBlock[], states: DDialogState[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const labelNode = node.childForFieldName("label");
    const label = labelNode ? labelName(labelNode) : undefined;

    blocks.push({
        kind: "chain",
        file,
        line: node.startPosition.row + 1,
        label,
    });

    flattenChain(node, file, label, states, "CHAIN");
}

function parseExtendAction(node: SyntaxNode, blocks: DDialogBlock[], states: DDialogState[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const statesField = node.childrenForFieldName("states");
    const stateRefs = statesField.map((s) => labelName(s)).join(", ");
    const line = node.startPosition.row + 1;

    blocks.push({
        kind: "extend",
        file,
        line,
        label: stateRefs || undefined,
    });

    // EXTEND adds transitions to existing states -- extract as pseudo-state
    const transitions: DDialogTransition[] = [];
    for (const child of node.children) {
        if (child.type === SyntaxType.Transition) {
            transitions.push(...parseTransitionContainer(child));
        }
    }

    if (transitions.length > 0) {
        states.push({
            label: stateRefs || "extended",
            line,
            sayText: "",
            speaker: file,
            blockFile: file,
            transitions,
            // Tag with blockLabel so getBlockStates doesn't mix with APPEND states
            blockLabel: `extend_${line}`,
            // EXTEND adds transitions to an existing state elsewhere; this pseudo-state has
            // no standalone source block here, so the editor renders it read-only.
            derivedFrom: "EXTEND",
        });
    }
}

function parseInterjectAction(node: SyntaxNode, blocks: DDialogBlock[], states: DDialogState[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const labelNode = node.childForFieldName("label");
    const label = labelNode ? labelName(labelNode) : undefined;

    blocks.push({
        kind: "interject",
        file,
        line: node.startPosition.row + 1,
        label,
    });

    // Interjects may contain chain-like text sequences
    flattenChain(node, file, label, states, "INTERJECT");
}

// ---------------------------------------------------------------------------
// State parser
// ---------------------------------------------------------------------------

function parseState(node: SyntaxNode, speaker: string): DDialogState | undefined {
    const labelNode = node.childForFieldName("label");
    if (!labelNode) return undefined;

    const label = labelName(labelNode);
    const sayText = extractSayText(node);
    const sayTexts = extractSayTexts(node);
    const trigger = extractTrigger(node);
    const weight = extractWeight(node);
    const transitions: DDialogTransition[] = [];

    for (const child of node.children) {
        if (child.type === SyntaxType.Transition) {
            transitions.push(...parseTransitionContainer(child));
        }
    }

    // Field ranges for per-field surgical edits: the SAY value node (the `say` field,
    // covering the value after the SAY keyword) and the trigger string node.
    const sayNode = node.childForFieldName("say");
    const triggerNode = node.childForFieldName("trigger");

    return {
        label,
        line: node.startPosition.row + 1,
        sayText,
        sayTexts,
        trigger: trigger || undefined,
        weight,
        speaker,
        blockFile: speaker,
        transitions,
        range: { start: node.startIndex, end: node.endIndex },
        sayRange: sayNode ? { start: sayNode.startIndex, end: sayNode.endIndex } : undefined,
        triggerRange: triggerNode ? { start: triggerNode.startIndex, end: triggerNode.endIndex } : undefined,
    };
}

// ---------------------------------------------------------------------------
// Transition parsers
// ---------------------------------------------------------------------------

/**
 * Parse all transitions inside a transition container node.
 * A Transition node wraps one or more TransitionFull, TransitionShort, or CopyTrans.
 */
function parseTransitionContainer(container: SyntaxNode): DDialogTransition[] {
    const transitions: DDialogTransition[] = [];

    for (const child of container.children) {
        switch (child.type) {
            case SyntaxType.TransitionFull:
                transitions.push(parseTransitionFull(child));
                break;
            case SyntaxType.TransitionShort:
                transitions.push(parseTransitionShort(child));
                break;
            case SyntaxType.CopyTrans:
                transitions.push(parseCopyTrans(child));
                break;
        }
    }

    // If the container itself has target nodes directly (not wrapped in full/short)
    if (transitions.length === 0) {
        const target = extractTarget(container);
        if (target) {
            transitions.push({
                line: container.startPosition.row + 1,
                target,
            });
        }
    }

    return transitions;
}

function parseTransitionFull(node: SyntaxNode): DDialogTransition {
    const trigger = extractTransitionTrigger(node);
    const replyText = extractReplyText(node);
    const action = extractDoAction(node);
    const target = extractTarget(node) ?? { kind: "exit" as const };

    return {
        line: node.startPosition.row + 1,
        // An EMPTY reply (`REPLY ~~`) stays "" - the author wrote a reply form, so it must round-trip as
        // a (blank) player option, not degrade to a bare transition. Only a MISSING reply is undefined.
        replyText,
        trigger: trigger || undefined,
        action: action || undefined,
        target,
        range: { start: node.startIndex, end: node.endIndex },
        targetRange: extractTargetLabelRange(node),
    };
}

function parseTransitionShort(node: SyntaxNode): DDialogTransition {
    const replyNode = node.childForFieldName("reply");
    const replyText = replyNode ? extractSayTextContent(replyNode) : undefined;
    // The grammar's transition_short carries an optional inline trigger between its two
    // `+` markers, in the same "trigger" field transition_full uses. Extract it so a
    // conditional short reply (`+ ~cond~ + reply`) keeps its condition on parse.
    const trigger = extractTransitionTrigger(node);
    const action = extractDoAction(node);

    // Short transitions use short_goto for target
    const target = extractTarget(node) ?? { kind: "exit" as const };

    return {
        line: node.startPosition.row + 1,
        // As in parseTransitionFull: an EMPTY `++ ~~` reply stays "" (a blank player option, e.g. one the
        // editor just spliced before its text was typed); only a missing reply node is undefined.
        replyText,
        trigger: trigger || undefined,
        action: action || undefined,
        target,
        range: { start: node.startIndex, end: node.endIndex },
        targetRange: extractTargetLabelRange(node),
    };
}

function parseCopyTrans(node: SyntaxNode): DDialogTransition {
    const file = getNodeFieldText(node, "file") ?? "";
    const stateNode = node.childForFieldName("state");
    const label = stateNode ? labelName(stateNode) : "";

    return {
        line: node.startPosition.row + 1,
        target: { kind: "copy_trans", file, label },
        range: { start: node.startIndex, end: node.endIndex },
    };
}

// ---------------------------------------------------------------------------
// CHAIN flattening
// ---------------------------------------------------------------------------

/**
 * Flatten a CHAIN (or INTERJECT) into synthetic states, one per speaker run, BRANCH speakers included, linked the
 * way WeiDU links a chain's lines: each state goes to the next, guarded by that state's condition, and past a
 * conditional state also to the one after it, until an unconditional state or the end, where the epilogue's
 * transitions apply. A false condition so skips its line instead of ending the chain.
 */
function flattenChain(
    node: SyntaxNode,
    initialSpeaker: string,
    chainLabel: string | undefined,
    states: DDialogState[],
    derivedFrom: "CHAIN" | "INTERJECT",
): void {
    const lines: Array<{ state: DDialogState; condition: string | undefined }> = [];
    let epilogue: DDialogTransition[] = [];
    let currentSpeaker = initialSpeaker;

    const pushChainState = (child: SyntaxNode, branchConditions: readonly string[]): void => {
        // Record the FULL multisay list (parity with parseState); sayText stays the first for the flat display.
        const sayTexts = extractChainTexts(child);
        const sayText = sayTexts[0]?.text ?? "";
        // A BRANCH trigger guards every line inside it, outer branches first, as WeiDU joins them.
        const ownTrigger = extractChainTextTrigger(child);
        const condition = [...branchConditions, ...(ownTrigger ? [ownTrigger] : [])].join(" ") || undefined;
        const index = lines.length;
        const label = index === 0 && chainLabel ? chainLabel : `${chainLabel ?? "chain"}_${index}`;
        const state: DDialogState = {
            label,
            line: child.startPosition.row + 1,
            sayText,
            ...(sayTexts.length > 0 ? { sayTexts } : {}),
            trigger: condition,
            speaker: currentSpeaker,
            // Owning dialog is the chain's target file, never the per-line switched speaker.
            blockFile: initialSpeaker,
            transitions: [],
            blockLabel: chainLabel,
            // Synthetic: a CHAIN/INTERJECT link has no standalone source block, so the
            // editor renders it read-only (no range to splice an edit back into).
            derivedFrom,
        };
        lines.push({ state, condition });
    };

    const visit = (container: SyntaxNode, branchConditions: readonly string[]): void => {
        for (const child of container.children) {
            if (child.type === SyntaxType.ChainText) {
                // The entry speaker's lines; each `== ~file~ @text` speaker that follows is a sibling
                // chain_speaker. Both produce states, and a speaker line also switches the speaking actor.
                pushChainState(child, branchConditions);
            } else if (child.type === SyntaxType.ChainSpeaker) {
                const speakerFile = getNodeFieldText(child, "file");
                if (speakerFile) {
                    currentSpeaker = speakerFile;
                }
                pushChainState(child, branchConditions);
            } else if (child.type === SyntaxType.ChainBranch) {
                const triggerNode = child.childForFieldName("trigger");
                const trigger = triggerNode ? extractTextContent(triggerNode) : "";
                visit(child, trigger ? [...branchConditions, trigger] : branchConditions);
            } else if (child.type === SyntaxType.ChainEpilogue) {
                epilogue = parseChainEpilogue(child);
            }
        }
    };
    visit(node, []);

    for (const [i, { state }] of lines.entries()) {
        let reachesEnd = true;
        for (const next of lines.slice(i + 1)) {
            state.transitions.push({
                line: state.line,
                trigger: next.condition,
                target: { kind: "goto", label: next.state.label },
            });
            if (next.condition === undefined) {
                reachesEnd = false;
                break;
            }
        }
        if (reachesEnd) state.transitions.push(...epilogue.map((t) => ({ ...t })));
    }

    states.push(...lines.map((l) => l.state));
}

function parseChainEpilogue(node: SyntaxNode): DDialogTransition[] {
    const transitions: DDialogTransition[] = [];

    for (const child of node.children) {
        if (child.type === SyntaxType.Transition) {
            transitions.push(...parseTransitionContainer(child));
        }
    }
    if (transitions.length > 0) return transitions;

    const target = chainEpilogueTarget(node);
    return target ? [{ line: node.startPosition.row + 1, target }] : [];
}
