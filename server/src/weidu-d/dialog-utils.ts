/**
 * Utility functions for WeiDU D dialog tree parsing.
 * Text extraction, target resolution, and helper functions used by
 * both structural and modification block parsers.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "./tree-sitter.d";
import type { DDialogTarget } from "../../../shared/dialog-types";

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

export function extractSayText(stateNode: SyntaxNode): string {
    const sayNode = stateNode.childForFieldName("say");
    if (!sayNode) return "";
    return extractSayTextContent(sayNode);
}

/**
 * Extract text from a say_text node, which may contain tilde_string, tra_ref, tlk_ref, or at_var_ref.
 */
export function extractSayTextContent(sayTextNode: SyntaxNode): string {
    for (const child of sayTextNode.children) {
        switch (child.type) {
            case SyntaxType.TildeString:
                return extractTildeContent(child);
            case SyntaxType.String:
                return extractStringContent(child);
            case SyntaxType.TraRef:
                return child.text;
            case SyntaxType.TlkRef:
                return child.text;
            case SyntaxType.AtVarRef:
                return child.text;
            case SyntaxType.DoubleString:
                return extractDoubleContent(child);
        }
    }
    return sayTextNode.text.trim();
}

function extractTildeContent(node: SyntaxNode): string {
    for (const child of node.children) {
        if (child.type === SyntaxType.TildeContent) {
            return child.text;
        }
    }
    // Fallback: strip surrounding tildes
    const text = node.text;
    if (text.startsWith("~") && text.endsWith("~")) {
        return text.slice(1, -1);
    }
    return text;
}

function extractStringContent(node: SyntaxNode): string {
    // String node may contain tilde_string, double_string, etc.
    for (const child of node.children) {
        if (child.type === SyntaxType.TildeString) {
            return extractTildeContent(child);
        }
        if (child.type === SyntaxType.DoubleString) {
            return extractDoubleContent(child);
        }
    }
    return node.text;
}

function extractDoubleContent(node: SyntaxNode): string {
    for (const child of node.children) {
        if (child.type === SyntaxType.DoubleContent) {
            return child.text;
        }
    }
    const text = node.text;
    if (text.startsWith('"') && text.endsWith('"')) {
        return text.slice(1, -1);
    }
    return text;
}

export function extractTextContent(node: SyntaxNode): string {
    switch (node.type) {
        case SyntaxType.TildeString:
            return extractTildeContent(node);
        case SyntaxType.String:
            return extractStringContent(node);
        case SyntaxType.TraRef:
        case SyntaxType.TlkRef:
        case SyntaxType.AtVarRef:
            return node.text;
        case SyntaxType.DoubleString:
            return extractDoubleContent(node);
        default:
            // For say_text or other wrapper nodes
            return extractSayTextContent(node);
    }
}

export function extractChainText(chainTextNode: SyntaxNode): string {
    // chain_text children include say_text nodes
    for (const child of chainTextNode.children) {
        if (child.type === SyntaxType.SayText) {
            return extractSayTextContent(child);
        }
    }
    // Fallback: look for direct text content nodes
    for (const child of chainTextNode.children) {
        switch (child.type) {
            case SyntaxType.TildeString:
                return extractTildeContent(child);
            case SyntaxType.String:
                return extractStringContent(child);
            case SyntaxType.TraRef:
            case SyntaxType.TlkRef:
            case SyntaxType.AtVarRef:
                return child.text;
        }
    }
    return chainTextNode.text.trim();
}

export function extractChainTextTrigger(chainTextNode: SyntaxNode): string | undefined {
    const triggerNode = chainTextNode.childForFieldName("trigger");
    if (!triggerNode) return undefined;
    return extractStringContent(triggerNode) || undefined;
}

export function extractTrigger(stateNode: SyntaxNode): string | undefined {
    const triggerNode = stateNode.childForFieldName("trigger");
    if (!triggerNode) return undefined;
    const content = extractStringContent(triggerNode);
    // Empty trigger (~~ or "") is not meaningful
    if (!content.trim()) return undefined;
    return content;
}

export function extractTransitionTrigger(transitionNode: SyntaxNode): string | undefined {
    const triggerNode = transitionNode.childForFieldName("trigger");
    if (!triggerNode) return undefined;
    const content = extractStringContent(triggerNode);
    if (!content.trim()) return undefined;
    return content;
}

export function extractDoAction(transitionNode: SyntaxNode): string | undefined {
    for (const child of transitionNode.children) {
        if (child.type === SyntaxType.DoFeature) {
            const actionNode = child.childForFieldName("action");
            if (actionNode) {
                return extractStringContent(actionNode);
            }
        }
    }
    return undefined;
}

export function extractReplyText(transitionNode: SyntaxNode): string | undefined {
    for (const child of transitionNode.children) {
        if (child.type === SyntaxType.ReplyFeature) {
            const textNode = child.childForFieldName("text");
            if (textNode) {
                return extractTextContent(textNode);
            }
        }
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Target extraction
// ---------------------------------------------------------------------------

export function extractTarget(node: SyntaxNode): DDialogTarget | undefined {
    for (const child of node.children) {
        switch (child.type) {
            case SyntaxType.GotoNext: {
                const labelNode = child.childForFieldName("label");
                if (labelNode) {
                    return { kind: "goto", label: labelNode.text };
                }
                break;
            }
            case SyntaxType.ShortGoto: {
                const labelNode = child.childForFieldName("label");
                if (labelNode) {
                    return { kind: "goto", label: labelNode.text };
                }
                break;
            }
            case SyntaxType.ExternNext: {
                const fileNode = child.childForFieldName("file");
                const labelNode = child.childForFieldName("label");
                if (fileNode && labelNode) {
                    return { kind: "extern", file: fileNode.text, label: labelNode.text };
                }
                break;
            }
            case SyntaxType.ExitNext:
                return { kind: "exit" };
            case SyntaxType.CopyTrans: {
                const fileNode = child.childForFieldName("file");
                const stateNode = child.childForFieldName("state");
                if (fileNode && stateNode) {
                    return { kind: "copy_trans", file: fileNode.text, label: stateNode.text };
                }
                break;
            }
        }

        // Recurse into transition containers
        const nested = extractTarget(child);
        if (nested) return nested;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// ALTER_TRANS detail extraction
// ---------------------------------------------------------------------------

/**
 * Extract human-readable summary from ALTER_TRANS node.
 * ALTER_TRANS file BEGIN state END BEGIN trans END BEGIN changes END
 * The grammar doesn't expose state/trans as named fields, so we walk children.
 */
export function extractAlterTransParts(node: SyntaxNode): string {
    const parts: string[] = [];
    // Collect all AlterTransChange children for the change descriptions
    for (const child of node.children) {
        if (child.type === SyntaxType.AlterTransChange) {
            parts.push(truncate(child.text, 60));
        }
    }
    if (parts.length > 0) {
        return parts.join("; ");
    }
    return "";
}

// ---------------------------------------------------------------------------
// General utility
// ---------------------------------------------------------------------------

/**
 * Extract state label references from unnamed _state_label_list children.
 * These appear as Identifier/StateLabelAlnum/Number nodes between BEGIN/END keywords.
 */
export function extractStateRefs(node: SyntaxNode): string[] {
    const refs: string[] = [];
    let inList = false;
    let listCount = 0;
    for (const child of node.children) {
        // "BEGIN" and "END" are tree-sitter anonymous (keyword) nodes, not named node types.
        // They don't appear in the SyntaxType enum and must be matched as raw strings.
        if (child.type === "BEGIN") {
            // Only the first BEGIN...END pair is the state list
            if (listCount === 0) {
                inList = true;
            }
            continue;
        }
        if (child.type === "END") {
            if (inList) {
                inList = false;
                listCount++;
            }
            continue;
        }
        if (inList) {
            refs.push(child.text);
        }
    }
    return refs;
}

export function getNodeFieldText(node: SyntaxNode, fieldName: string): string | undefined {
    const child = node.childForFieldName(fieldName);
    if (!child) return undefined;
    // Strip quotes/tildes from identifiers and strings
    const text = child.text;
    if ((text.startsWith("~") && text.endsWith("~")) || (text.startsWith('"') && text.endsWith('"'))) {
        return text.slice(1, -1);
    }
    return text;
}

export function truncate(text: string, maxLen: number): string {
    const singleLine = text.replace(/\s+/g, " ").trim();
    if (singleLine.length <= maxLen) return singleLine;
    return singleLine.slice(0, maxLen - 1) + "\u2026";
}
