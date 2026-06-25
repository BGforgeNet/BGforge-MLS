/**
 * Dialog parser for Fallout SSL scripts using tree-sitter.
 * Extracts dialog structure (nodes, replies, options) for visualization.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { initParser, parseWithCache, isInitialized } from "../../shared/parsers/fallout-ssl";
import { SyntaxType } from "./fallout-ssl/syntax-type";
import type {
    SSLDialogData,
    SSLDialogNode,
    SSLDialogOption,
    SSLDialogOptionType,
    SSLDialogReply,
} from "../../shared/dialog-types";

export type { SSLDialogData as DialogData };

// Membership sets for SSL option/message types. Using ReadonlySet<string>
// (rather than Set<SSLDialogOptionType>) lets the .has() check act as a
// type guard via `isOptionFn`/`isMessageFn` below - no `as` cast needed.
const OPTION_FN_NAMES: ReadonlySet<string> = new Set<SSLDialogOptionType>([
    "NOption",
    "NLowOption",
    "GOption",
    "GLowOption",
    "BOption",
    "BLowOption",
]);

const MESSAGE_FN_NAMES: ReadonlySet<string> = new Set<SSLDialogOptionType>(["NMessage", "GMessage", "BMessage"]);

function isOptionFn(name: string): name is SSLDialogOptionType {
    return OPTION_FN_NAMES.has(name);
}

function isMessageFn(name: string): name is SSLDialogOptionType {
    return MESSAGE_FN_NAMES.has(name);
}

/**
 * Parse dialog structure from SSL script text using tree-sitter
 */
export async function parseDialog(text: string): Promise<SSLDialogData> {
    if (!isInitialized()) {
        await initParser();
    }
    const tree = parseWithCache(text);
    if (!tree) {
        return { nodes: [], entryPoints: [] };
    }
    const root = tree.rootNode;

    const nodes: SSLDialogNode[] = [];
    const entryPoints: string[] = [];

    // First pass: parse every dialog procedure into a map; collect entry points
    // from talk_p_proc (the single dialog root).
    const parsed = new Map<string, SSLDialogNode>();
    for (const child of root.children) {
        if (child.type !== SyntaxType.Procedure) continue;
        const nameNode = child.childForFieldName("name");
        if (!nameNode) continue;
        const procName = nameNode.text;

        if (procName === "talk_p_proc") {
            extractEntryPoints(child, entryPoints);
            continue;
        }
        parsed.set(procName, parseProcedure(child, procName));
    }

    // force_dialog_start(Node*) / start_dialog_at_node(Node*) start a conversation
    // from outside talk_p_proc (timers, map-enter); treat their targets as entries.
    walkTree(root, (node) => {
        if (node.type !== SyntaxType.CallExpr) return;
        const fn = node.childForFieldName("func")?.text;
        if (fn !== "force_dialog_start" && fn !== "start_dialog_at_node") return;
        const arg = getCallArgs(node)[0];
        if (!arg) return;
        const name = arg.type === SyntaxType.CallExpr ? arg.childForFieldName("func")?.text : arg.text;
        if (name && !entryPoints.includes(name)) entryPoints.push(name);
    });

    // Second pass: include a node if it carries dialog content, OR if another node
    // routes to it - a side-effect-only target (e.g. a teleport/combat node) must
    // not be dropped, or its inbound edge would dangle.
    const referenced = new Set<string>();
    for (const node of parsed.values()) {
        for (const opt of node.options) if (opt.target) referenced.add(opt.target);
        for (const t of node.callTargets) referenced.add(t);
    }
    for (const [procName, node] of parsed) {
        const hasContent = node.replies.length > 0 || node.options.length > 0 || node.callTargets.length > 0;
        if (hasContent || referenced.has(procName)) nodes.push(node);
    }

    return { nodes, entryPoints };
}

function extractEntryPoints(proc: SyntaxNode, entryPoints: string[]): void {
    // Find call statements and call expressions
    walkTree(proc, (node) => {
        if (node.type === SyntaxType.CallStmt) {
            const target = node.childForFieldName("target");
            if (target) {
                const name = target.type === SyntaxType.CallExpr ? target.childForFieldName("func")?.text : target.text;
                if (name && !entryPoints.includes(name)) {
                    entryPoints.push(name);
                }
            }
        } else if (node.type === SyntaxType.CallExpr) {
            const func = node.childForFieldName("func");
            if (func?.text.startsWith("Node") && !entryPoints.includes(func.text)) {
                entryPoints.push(func.text);
            }
        }
    });
}

function parseProcedure(proc: SyntaxNode, name: string): SSLDialogNode {
    const replies: SSLDialogReply[] = [];
    const options: SSLDialogOption[] = [];
    const callTargets: string[] = [];

    walkTree(proc, (node) => {
        if (node.type === SyntaxType.CallExpr) {
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
                    conditional: enclosingCondition(node),
                    msgKind: classifyMsgId(arg0),
                });
            }

            // NOption, GOption, BOption, and Low variants - narrows funcName.
            if (isOptionFn(funcName) && arg0 && arg1) {
                const target = arg1.text;
                options.push({
                    type: funcName,
                    msgId: parseArgValue(arg0),
                    target,
                    skill: arg2 ? parseInt(arg2.text, 10) : undefined,
                    line,
                    conditional: enclosingCondition(node),
                    msgKind: classifyMsgId(arg0),
                });
            }

            // NMessage, GMessage, BMessage (terminal) - narrows funcName.
            if (isMessageFn(funcName) && arg0) {
                options.push({
                    type: funcName,
                    msgId: parseArgValue(arg0),
                    target: "",
                    line,
                    conditional: enclosingCondition(node),
                    msgKind: classifyMsgId(arg0),
                });
            }
        }

        // Collect "call Node*" statements as direct transitions
        if (node.type === SyntaxType.CallStmt) {
            const target = node.childForFieldName("target");
            if (target) {
                const targetName =
                    target.type === SyntaxType.CallExpr ? target.childForFieldName("func")?.text : target.text;
                // Keep any resolved call target, not just Node* - `call combat`/`call barter`
                // are real transitions out of the dialog.
                if (targetName && !callTargets.includes(targetName)) {
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
    if (node.type === SyntaxType.Number) {
        return parseInt(node.text, 10);
    }
    return node.text;
}

/**
 * Classify a message-id argument for the honesty badges. A plain numeric literal is a
 * fixed id (undefined - no badge). A `random(...)` call yields one of several lines at
 * runtime (`random`). Anything else (a variable, an expression) is `computed` - the
 * shown line is approximate because the real id is only known at runtime.
 */
function classifyMsgId(node: SyntaxNode): "computed" | "random" | undefined {
    if (node.type === SyntaxType.Number) return undefined;
    if (node.type === SyntaxType.CallExpr) {
        return node.childForFieldName("func")?.text === "random" ? "random" : "computed";
    }
    return "computed";
}

/**
 * Walk up from a dialog call to the nearest enclosing `if`, returning its
 * condition text. The SSL derived graph is read-only and approximate, so a
 * conditional reply/option must be marked rather than shown as unconditional.
 */
function enclosingCondition(node: SyntaxNode): string | undefined {
    let cur: SyntaxNode | null = node.parent;
    while (cur) {
        if (cur.type === SyntaxType.IfStmt) {
            return cur.childForFieldName("cond")?.text;
        }
        cur = cur.parent;
    }
    return undefined;
}

function walkTree(node: SyntaxNode, callback: (_node: SyntaxNode) => void): void {
    callback(node);
    for (const child of node.children) {
        walkTree(child, callback);
    }
}
