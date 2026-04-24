/**
 * Dialog parser for Fallout SSL scripts using tree-sitter.
 * Extracts dialog structure (nodes, replies, options) for visualization.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { initParser, parseWithCache, isInitialized } from "./fallout-ssl/parser";

interface DialogReply {
    msgId: number | string;
    line: number;
    conditional?: string;
}

/**
 * Types of dialog options and messages.
 */
enum DialogOptionType {
    NOption = "NOption",
    NLowOption = "NLowOption",
    GOption = "GOption",
    GLowOption = "GLowOption",
    BOption = "BOption",
    BLowOption = "BLowOption",
    NMessage = "NMessage",
    GMessage = "GMessage",
    BMessage = "BMessage",
}

interface DialogOption {
    msgId: number | string;
    target: string;
    skill?: number;
    type: DialogOptionType;
    line: number;
}

export interface DialogNode {
    name: string;
    line: number;
    replies: DialogReply[];
    options: DialogOption[];
    callTargets: string[]; // Direct "call Node*" transitions
}

export interface DialogData {
    nodes: DialogNode[];
    entryPoints: string[];
}

/**
 * Parse dialog structure from SSL script text using tree-sitter
 */
export async function parseDialog(text: string): Promise<DialogData> {
    if (!isInitialized()) {
        await initParser();
    }
    const tree = parseWithCache(text);
    if (!tree) {
        return { nodes: [], entryPoints: [] };
    }
    const root = tree.rootNode;

    const nodes: DialogNode[] = [];
    const entryPoints: string[] = [];

    // Find all procedures
    for (const child of root.children) {
        if (child.type === "procedure") {
            const nameNode = child.childForFieldName("name");
            if (!nameNode) continue;

            const procName = nameNode.text;

            // Get entry points from talk_p_proc
            if (procName === "talk_p_proc") {
                extractEntryPoints(child, entryPoints);
                continue;
            }

            // Parse dialog node
            const dialogNode = parseProcedure(child, procName);
            if (dialogNode.replies.length > 0 || dialogNode.options.length > 0 || dialogNode.callTargets.length > 0) {
                nodes.push(dialogNode);
            }
        }
    }

    return { nodes, entryPoints };
}

function extractEntryPoints(proc: SyntaxNode, entryPoints: string[]): void {
    // Find call statements and call expressions
    walkTree(proc, (node) => {
        if (node.type === "call_stmt") {
            const target = node.childForFieldName("target");
            if (target) {
                const name = target.type === "call_expr" ? target.childForFieldName("func")?.text : target.text;
                if (name && !entryPoints.includes(name)) {
                    entryPoints.push(name);
                }
            }
        } else if (node.type === "call_expr") {
            const func = node.childForFieldName("func");
            if (func?.text.startsWith("Node") && !entryPoints.includes(func.text)) {
                entryPoints.push(func.text);
            }
        }
    });
}

function parseProcedure(proc: SyntaxNode, name: string): DialogNode {
    const replies: DialogReply[] = [];
    const options: DialogOption[] = [];
    const callTargets: string[] = [];

    walkTree(proc, (node) => {
        if (node.type === "call_expr") {
            const funcNode = node.childForFieldName("func");
            if (!funcNode) return;

            const funcName = funcNode.text;
            const args = getCallArgs(node);
            const line = node.startPosition.row + 1;

            // Reply(msgId)
            const arg0 = args[0];
            const arg1 = args[1];
            const arg2 = args[2];

            if (funcName === "Reply" && arg0) {
                replies.push({
                    msgId: parseArgValue(arg0),
                    line,
                });
            }

            // NOption, GOption, BOption, etc.
            const optionTypes = [
                DialogOptionType.NOption,
                DialogOptionType.NLowOption,
                DialogOptionType.GOption,
                DialogOptionType.GLowOption,
                DialogOptionType.BOption,
                DialogOptionType.BLowOption,
            ];
            if (optionTypes.includes(funcName as DialogOptionType) && arg0 && arg1) {
                const target = arg1.text;
                options.push({
                    type: funcName as DialogOptionType,
                    msgId: parseArgValue(arg0),
                    target,
                    skill: arg2 ? parseInt(arg2.text, 10) : undefined,
                    line,
                });
            }

            // NMessage, GMessage, BMessage (terminal)
            const msgTypes = [DialogOptionType.NMessage, DialogOptionType.GMessage, DialogOptionType.BMessage];
            if (msgTypes.includes(funcName as DialogOptionType) && arg0) {
                options.push({
                    type: funcName as DialogOptionType,
                    msgId: parseArgValue(arg0),
                    target: "",
                    line,
                });
            }
        }

        // Collect "call Node*" statements as direct transitions
        if (node.type === "call_stmt") {
            const target = node.childForFieldName("target");
            if (target) {
                const targetName = target.type === "call_expr" ? target.childForFieldName("func")?.text : target.text;
                if (targetName?.startsWith("Node") && !callTargets.includes(targetName)) {
                    callTargets.push(targetName);
                }
            }
        }
    });

    return {
        name,
        line: proc.startPosition.row + 1,
        replies,
        options,
        callTargets,
    };
}

function getCallArgs(callExpr: SyntaxNode): SyntaxNode[] {
    // namedChildren[0] is the func, rest are args
    return callExpr.namedChildren.slice(1);
}

function parseArgValue(node: SyntaxNode): number | string {
    if (node.type === "number") {
        return parseInt(node.text, 10);
    }
    return node.text;
}

function walkTree(node: SyntaxNode, callback: (_node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children) {
        walkTree(child, callback);
    }
}
