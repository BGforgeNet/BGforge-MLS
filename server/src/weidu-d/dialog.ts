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
import { parseWithCache, isInitialized } from "./parser";
import { SyntaxType } from "./tree-sitter.d";
import type { DDialogBlock, DDialogData, DDialogState, DDialogTransition } from "../../../shared/dialog-types";
import {
    extractSayText,
    extractSayTextContent,
    extractChainText,
    extractChainTextTrigger,
    extractTrigger,
    extractTransitionTrigger,
    extractDoAction,
    extractReplyText,
    extractTarget,
    getNodeFieldText,
} from "./dialog-utils";
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
    if (!isInitialized()) {
        return { blocks: [], states: [] };
    }
    const tree = parseWithCache(text);
    if (!tree) {
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
    node: SyntaxNode, blocks: DDialogBlock[], states: DDialogState[],
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
    const label = labelNode ? labelNode.text : undefined;

    blocks.push({
        kind: "chain",
        file,
        line: node.startPosition.row + 1,
        label,
    });

    flattenChain(node, file, label, states);
}

function parseExtendAction(node: SyntaxNode, blocks: DDialogBlock[], states: DDialogState[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const statesField = node.childrenForFieldName("states");
    const stateRefs = statesField.map((s) => s.text).join(", ");
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
            transitions,
            // Tag with blockLabel so getBlockStates doesn't mix with APPEND states
            blockLabel: `extend_${line}`,
        });
    }
}

function parseInterjectAction(node: SyntaxNode, blocks: DDialogBlock[], states: DDialogState[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const labelNode = node.childForFieldName("label");
    const label = labelNode ? labelNode.text : undefined;

    blocks.push({
        kind: "interject",
        file,
        line: node.startPosition.row + 1,
        label,
    });

    // Interjects may contain chain-like text sequences
    flattenChain(node, file, label, states);
}


// ---------------------------------------------------------------------------
// State parser
// ---------------------------------------------------------------------------

function parseState(node: SyntaxNode, speaker: string): DDialogState | undefined {
    const labelNode = node.childForFieldName("label");
    if (!labelNode) return undefined;

    const label = labelNode.text;
    const sayText = extractSayText(node);
    const trigger = extractTrigger(node);
    const transitions: DDialogTransition[] = [];

    for (const child of node.children) {
        if (child.type === SyntaxType.Transition) {
            transitions.push(...parseTransitionContainer(child));
        }
    }

    return {
        label,
        line: node.startPosition.row + 1,
        sayText,
        trigger: trigger || undefined,
        speaker,
        transitions,
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
        replyText: replyText || undefined,
        trigger: trigger || undefined,
        action: action || undefined,
        target,
    };
}

function parseTransitionShort(node: SyntaxNode): DDialogTransition {
    const replyNode = node.childForFieldName("reply");
    const replyText = replyNode ? extractSayTextContent(replyNode) : undefined;
    const action = extractDoAction(node);

    // Short transitions use short_goto for target
    const target = extractTarget(node) ?? { kind: "exit" as const };

    return {
        line: node.startPosition.row + 1,
        replyText: replyText || undefined,
        action: action || undefined,
        target,
    };
}

function parseCopyTrans(node: SyntaxNode): DDialogTransition {
    const file = getNodeFieldText(node, "file") ?? "";
    const stateNode = node.childForFieldName("state");
    const label = stateNode ? stateNode.text : "";

    return {
        line: node.startPosition.row + 1,
        target: { kind: "copy_trans", file, label },
    };
}

// ---------------------------------------------------------------------------
// CHAIN flattening
// ---------------------------------------------------------------------------

/**
 * Flatten a CHAIN (or INTERJECT) into synthetic states connected by GOTO transitions.
 */
function flattenChain(
    node: SyntaxNode,
    initialSpeaker: string,
    chainLabel: string | undefined,
    states: DDialogState[],
): void {
    const syntheticStates: DDialogState[] = [];
    let currentSpeaker = initialSpeaker;
    let stateIndex = 0;

    for (const child of node.children) {
        if (child.type === SyntaxType.ChainText) {
            const sayText = extractChainText(child);
            const trigger = extractChainTextTrigger(child);
            const label = stateIndex === 0 && chainLabel
                ? chainLabel
                : `${chainLabel ?? "chain"}_${stateIndex}`;

            syntheticStates.push({
                label,
                line: child.startPosition.row + 1,
                sayText,
                trigger: trigger || undefined,
                speaker: currentSpeaker,
                transitions: [],
                blockLabel: chainLabel,
            });
            stateIndex++;
        } else if (child.type === SyntaxType.ChainSpeaker) {
            const speakerFile = getNodeFieldText(child, "file");
            if (speakerFile) {
                currentSpeaker = speakerFile;
            }
        } else if (child.type === SyntaxType.ChainEpilogue) {
            // Epilogue contains the final transition(s) for the chain
            const transitions = parseChainEpilogue(child);
            if (syntheticStates.length > 0) {
                const lastState = syntheticStates[syntheticStates.length - 1]!;
                lastState.transitions.push(...transitions);
            }
        } else if (child.type === SyntaxType.ChainBranch) {
            // Branch: conditional transitions within a chain
            const transitions = parseChainBranch(child);
            if (syntheticStates.length > 0) {
                const lastState = syntheticStates[syntheticStates.length - 1]!;
                lastState.transitions.push(...transitions);
            }
        }
    }

    // Connect sequential chain states with GOTO transitions
    for (let i = 0; i < syntheticStates.length - 1; i++) {
        const current = syntheticStates[i]!;
        const next = syntheticStates[i + 1]!;
        // Only add auto-transition if no explicit transitions exist
        if (current.transitions.length === 0) {
            current.transitions.push({
                line: current.line,
                target: { kind: "goto", label: next.label },
            });
        }
    }

    states.push(...syntheticStates);
}

function parseChainEpilogue(node: SyntaxNode): DDialogTransition[] {
    const transitions: DDialogTransition[] = [];

    for (const child of node.children) {
        if (child.type === SyntaxType.Transition) {
            transitions.push(...parseTransitionContainer(child));
        }
    }

    // Direct target on epilogue itself
    if (transitions.length === 0) {
        const target = extractTarget(node);
        if (target) {
            transitions.push({
                line: node.startPosition.row + 1,
                target,
            });
        }
    }

    return transitions;
}

function parseChainBranch(node: SyntaxNode): DDialogTransition[] {
    const transitions: DDialogTransition[] = [];

    for (const child of node.children) {
        if (child.type === SyntaxType.Transition) {
            transitions.push(...parseTransitionContainer(child));
        }
    }

    return transitions;
}
