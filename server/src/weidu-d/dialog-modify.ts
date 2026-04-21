/**
 * Modification block parsers for WeiDU D dialog tree.
 * Handles ALTER_TRANS, ADD_STATE_TRIGGER, ADD_TRANS_ACTION, REPLACE_SAY, etc.
 * These blocks patch existing dialog states rather than creating new ones.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import type { DDialogBlock } from "../../../shared/dialog-types";
import {
    extractAlterTransParts,
    extractStateRefs,
    getNodeFieldText,
    truncate,
    extractTextContent,
} from "./dialog-utils";

export function parseAlterTrans(node: SyntaxNode, blocks: DDialogBlock[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const stateRefs = extractStateRefs(node);
    const changes = extractAlterTransParts(node);

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName: "ALTER_TRANS",
        description: changes || undefined,
        stateRefs: stateRefs.length > 0 ? stateRefs : undefined,
    });
}

export function parseAddStateTrigger(node: SyntaxNode, blocks: DDialogBlock[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const state = getNodeFieldText(node, "state") ?? "?";
    const trigger = getNodeFieldText(node, "trigger") ?? "";

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName: "ADD_STATE_TRIGGER",
        description: truncate(trigger, 80) || undefined,
        stateRefs: [state],
    });
}

export function parseAddTransAction(node: SyntaxNode, blocks: DDialogBlock[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const stateRefs = extractStateRefs(node);
    const action = getNodeFieldText(node, "action") ?? "";

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName: "ADD_TRANS_ACTION",
        description: truncate(action, 80) || undefined,
        stateRefs: stateRefs.length > 0 ? stateRefs : undefined,
    });
}

export function parseAddTransTrigger(node: SyntaxNode, blocks: DDialogBlock[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const state = getNodeFieldText(node, "state") ?? "?";
    const trigger = getNodeFieldText(node, "trigger") ?? "";

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName: "ADD_TRANS_TRIGGER",
        description: truncate(trigger, 80) || undefined,
        stateRefs: [state],
    });
}

export function parseReplaceSay(node: SyntaxNode, blocks: DDialogBlock[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const state = getNodeFieldText(node, "state") ?? "?";
    const textNode = node.childForFieldName("text");
    const text = textNode ? extractTextContent(textNode) : "";

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName: "REPLACE_SAY",
        description: truncate(text, 80) || undefined,
        stateRefs: [state],
    });
}

export function parseReplaceStateTrigger(node: SyntaxNode, blocks: DDialogBlock[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const state = getNodeFieldText(node, "state") ?? "?";
    const trigger = getNodeFieldText(node, "trigger") ?? "";

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName: "REPLACE_STATE_TRIGGER",
        description: truncate(trigger, 80) || undefined,
        stateRefs: [state],
    });
}

export function parseReplaceTransAction(node: SyntaxNode, blocks: DDialogBlock[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const stateRefs = extractStateRefs(node);
    const oldText = getNodeFieldText(node, "old_text") ?? "";
    const newText = getNodeFieldText(node, "new_text") ?? "";

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName: "REPLACE_TRANS_ACTION",
        description: `${truncate(oldText, 40)} -> ${truncate(newText, 40)}`,
        stateRefs: stateRefs.length > 0 ? stateRefs : undefined,
    });
}

export function parseReplaceTransTrigger(node: SyntaxNode, blocks: DDialogBlock[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const stateRefs = extractStateRefs(node);
    const oldText = getNodeFieldText(node, "old_text") ?? "";
    const newText = getNodeFieldText(node, "new_text") ?? "";

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName: "REPLACE_TRANS_TRIGGER",
        description: `${truncate(oldText, 40)} -> ${truncate(newText, 40)}`,
        stateRefs: stateRefs.length > 0 ? stateRefs : undefined,
    });
}

export function parseSetWeight(node: SyntaxNode, blocks: DDialogBlock[]): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const state = getNodeFieldText(node, "state") ?? "?";
    const weightNodes = node.childrenForFieldName("weight");
    const weight = weightNodes.map((w) => w.text).join("");

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName: "SET_WEIGHT",
        description: weight || undefined,
        stateRefs: [state],
    });
}

export function parseReplaceText(node: SyntaxNode, blocks: DDialogBlock[], actionName: string): void {
    const file = getNodeFieldText(node, "file");
    if (!file) return;

    const oldText = getNodeFieldText(node, "old_text") ?? "";
    const newText = getNodeFieldText(node, "new_text") ?? "";

    blocks.push({
        kind: "modify",
        file,
        line: node.startPosition.row + 1,
        actionName,
        description: `${truncate(oldText, 40)} -> ${truncate(newText, 40)}`,
    });
}
