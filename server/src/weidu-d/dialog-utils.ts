/**
 * Utility functions for WeiDU D dialog tree parsing.
 * Text extraction, target resolution, and helper functions used by
 * both structural and modification block parsers.
 */

import type { Node as SyntaxNode } from "web-tree-sitter";
import { SyntaxType } from "./syntax-type";
import { labelName } from "./label-refs";
import type { DDialogTarget } from "@bgforge/shared/dialog-types";

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

export function extractSayText(stateNode: SyntaxNode): string {
    const sayNode = stateNode.childForFieldName("say");
    if (!sayNode) return "";
    return extractSayTextContent(sayNode);
}

// The `_text` alternatives a say_text node holds (one per multisay entry). Membership set so the same
// list drives both first-text extraction and the full multisay list.
const SAY_TEXT_KINDS: ReadonlySet<string> = new Set<string>([
    SyntaxType.TildeString,
    SyntaxType.String,
    SyntaxType.TraRef,
    SyntaxType.TlkRef,
    SyntaxType.AtVarRef,
    SyntaxType.DoubleString,
    SyntaxType.CompoundText,
    SyntaxType.ConcatString,
    SyntaxType.ForcedText,
]);

/**
 * Extract text from a say_text node, which may contain tilde_string, tra_ref, tlk_ref, or at_var_ref.
 * Returns the FIRST text of a multisay (`@a = @b`); use `extractSayTexts` for the whole list.
 */
export function extractSayTextContent(sayTextNode: SyntaxNode): string {
    for (const child of sayTextNode.children) {
        if (SAY_TEXT_KINDS.has(child.type)) return extractTextContent(child);
    }
    return sayTextNode.text.trim();
}

/**
 * Every text of a state's SAY, in source order, each with its range. A multisay
 * (`SAY @a = @b = @c`) yields one entry per text; a single SAY yields one entry.
 */
export function extractSayTexts(stateNode: SyntaxNode): Array<{ text: string; range: { start: number; end: number } }> {
    const sayNode = stateNode.childForFieldName("say");
    if (!sayNode) return [];
    return sayNode.children
        .filter((c) => SAY_TEXT_KINDS.has(c.type))
        .map((c) => ({ text: extractTextContent(c), range: { start: c.startIndex, end: c.endIndex } }));
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
        if (child.type === SyntaxType.FiveTildeString) {
            return child.namedChildren.find((c) => c.type === SyntaxType.FiveTildeContent)?.text ?? "";
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
        // A male/female pair shows its male text, the one the game falls back to; sounds are not text.
        case SyntaxType.CompoundText: {
            const male = node.childForFieldName("male");
            return male ? extractTextContent(male) : "";
        }
        // A `^`-joined run is one text: WeiDU concatenates the parts.
        case SyntaxType.ConcatString:
            return node.namedChildren.map((part) => extractTextContent(part)).join("");
        case SyntaxType.ForcedText: {
            const text = node.childForFieldName("text");
            return text ? extractTextContent(text) : "";
        }
        default:
            // For say_text or other wrapper nodes
            return extractSayTextContent(node);
    }
}

/**
 * Every text of one speaker's chain lines (a chain_text or chain_speaker), in source order with ranges. Each
 * `=`-joined line holds one `text` field, so `@a = @b = @c` yields one entry per line, the multisay analog of
 * `extractSayTexts` for the state case.
 */
export function extractChainTexts(
    chainTextNode: SyntaxNode,
): Array<{ text: string; range: { start: number; end: number } }> {
    return chainTextNode
        .childrenForFieldName("text")
        .map((c) => ({ text: extractTextContent(c), range: { start: c.startIndex, end: c.endIndex } }));
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

export function extractWeight(stateNode: SyntaxNode): number | undefined {
    // The `weight` field is one `#[-]number` token.
    const weightNode = stateNode.childForFieldName("weight");
    if (!weightNode) return undefined;
    const value = parseInt(weightNode.text.slice(1), 10);
    return Number.isNaN(value) ? undefined : value;
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

/** The transition features the model does not edit (FLAGS and the JOURNAL kinds), as source text in source order. */
export function extractVerbatimFeatures(transitionNode: SyntaxNode): string[] | undefined {
    const features = transitionNode.children
        .filter((c) => c.type === SyntaxType.FlagsFeature || c.type === SyntaxType.JournalFeature)
        .map((c) => c.text);
    return features.length > 0 ? features : undefined;
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
            case SyntaxType.GotoNext:
            case SyntaxType.ShortGoto: {
                const labelNode = child.childForFieldName("label");
                if (labelNode) {
                    return { kind: "goto", label: labelName(labelNode) };
                }
                break;
            }
            case SyntaxType.ExternNext: {
                const fileNode = child.childForFieldName("file");
                const labelNode = child.childForFieldName("label");
                if (fileNode && labelNode) {
                    return { kind: "extern", file: fileNode.text, label: labelName(labelNode) };
                }
                break;
            }
            case SyntaxType.ExitNext:
                return { kind: "exit" };
            case SyntaxType.CopyTrans: {
                const target = copyTransTarget(child);
                if (target) return target;
                break;
            }
        }

        // Recurse into transition containers
        const nested = extractTarget(child);
        if (nested) return nested;
    }
    return undefined;
}

/** The target of a COPY_TRANS transition: the state whose transitions it copies. */
export function copyTransTarget(node: SyntaxNode): DDialogTarget | undefined {
    const fileNode = node.childForFieldName("file");
    const stateNode = node.childForFieldName("state");
    if (!fileNode || !stateNode) return undefined;
    return { kind: "copy_trans", file: fileNode.text, label: labelName(stateNode) };
}

/**
 * Where a CHAIN or INTERJECT epilogue sends the chain's last line, for the forms that name one target: EXIT, and
 * `END file label` or `EXTERN file label`, which both leave for that state, and COPY_TRANS. `END` followed by
 * transitions carries them as transition nodes instead, so it has no single target here.
 */
export function chainEpilogueTarget(epilogue: SyntaxNode): DDialogTarget | undefined {
    // The epilogue's leading keyword is an anonymous token, so it has no SyntaxType member to compare against.
    const keyword = epilogue.firstChild?.type;
    if (keyword === "EXIT") return { kind: "exit" };
    const fileNode = epilogue.childForFieldName("file");
    const labelNode = epilogue.childForFieldName("label");
    if (!fileNode || !labelNode) return undefined;
    const label = labelName(labelNode);
    if (keyword === "COPY_TRANS" || keyword === "COPY_TRANS_LATE")
        return { kind: "copy_trans", file: fileNode.text, label };
    return { kind: "extern", file: fileNode.text, label };
}

/**
 * Span of a transition's target STATE label - the `label` of a `GOTO label` (goto_next) or
 * `+ label` (short_goto) - for a token-splice retarget that leaves the rest of the transition
 * byte-identical (see dialog-d-edit's fieldEditOps). Only state targets are spliceable this way;
 * EXIT/EXTERN/COPY_TRANS retargets change the clause's shape, so they return undefined and the
 * writer falls back to re-serializing the transition.
 */
export function extractTargetLabelRange(node: SyntaxNode): { start: number; end: number } | undefined {
    for (const child of node.children) {
        if (child.type === SyntaxType.GotoNext || child.type === SyntaxType.ShortGoto) {
            const labelNode = child.childForFieldName("label");
            if (labelNode) return { start: labelNode.startIndex, end: labelNode.endIndex };
        }
        const nested = extractTargetLabelRange(child);
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
    const singleLine = text.replaceAll(/\s+/g, " ").trim();
    if (singleLine.length <= maxLen) return singleLine;
    return singleLine.slice(0, maxLen - 1) + "\u2026";
}
