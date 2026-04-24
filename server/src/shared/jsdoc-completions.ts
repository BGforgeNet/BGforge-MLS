/**
 * Shared JSDoc completion items for use in any language provider.
 *
 * Derives tag completions from the canonical lists in jsdoc-types.ts
 * and type completions from a language-specific type metadata map.
 *
 * Position-based: analyzes the line text before cursor to determine
 * whether to return tags, types, or nothing.
 *
 * SYNC: shared/jsdoc-types.ts (canonical tag/type lists)
 */

import { CompletionItemKind, type CompletionItem, type Command } from "vscode-languageserver/node";
import { ALL_JSDOC_TAG_NAMES, JSDOC_PARAM_TAGS, JSDOC_RETURN_TAGS, JSDOC_STANDALONE_TAGS } from "./jsdoc-types";

/** Minimal type metadata needed for completion. */
interface TypeMeta {
    readonly detail: string;
}

/** What kind of JSDoc completion to offer based on cursor position within a JSDoc line. */
export enum JsdocPositionKind {
    /** Cursor is at a tag position: `@` or `@par...` */
    Tag = "tag",
    /** Cursor is at a type position: after a tag that expects a type argument */
    Type = "type",
    /** No JSDoc completion appropriate at this position */
    None = "none",
}

/** Re-trigger suggestions after accepting a tag that expects a type argument. */
const RETRIGGER_CMD: Command = { title: "", command: "editor.action.triggerSuggest" };

/** Tags that expect a type/name argument after them (insert trailing space + re-trigger). */
const TAGS_WITH_TYPE: ReadonlySet<string> = new Set([
    ...JSDOC_PARAM_TAGS,
    ...JSDOC_RETURN_TAGS,
    JSDOC_STANDALONE_TAGS[0],
]);

/** Detail strings for each tag group. First entry is the primary description, rest are aliases. */
const TAG_DETAILS: ReadonlyMap<string, string> = new Map([
    // Param tags
    ...JSDOC_PARAM_TAGS.map(
        (t, i) =>
            [t, i === 0 ? "Function parameter" : `Function parameter (alias for @${JSDOC_PARAM_TAGS[0]})`] as const,
    ),
    // Return tags
    ...JSDOC_RETURN_TAGS.map(
        (t, i) => [t, i === 0 ? "Return type" : `Return type (alias for @${JSDOC_RETURN_TAGS[0]})`] as const,
    ),
    // Standalone tags
    [JSDOC_STANDALONE_TAGS[0], "Variable type"],
    [JSDOC_STANDALONE_TAGS[1], "Mark as deprecated"],
]);

/**
 * Regex for type position: cursor is right after a type-expecting tag, at the first word slot.
 * Matches: `@param `, `@param {`, `@param {in`, `@param in`, `@type `, etc.
 * Does NOT match: `@param {int} ` (closing brace), `@param int ` (word + space), `@deprecated `.
 * Built dynamically from TAGS_WITH_TYPE to stay in sync with canonical lists.
 */
const TYPE_POSITION_RE = new RegExp(`@(?:${[...TAGS_WITH_TYPE].join("|")})\\s+\\{?\\w*$`);

/** Regex for tag position: cursor is at `@` or `@partial_name`. */
const TAG_POSITION_RE = /@\w*$/;

/**
 * Determine what kind of JSDoc completion to offer based on the line text before the cursor.
 *
 * @param linePrefix Line text from column 0 up to the cursor position
 * @returns Tag (at @...), Type (after tag expecting type), or None
 */
export function getJsdocPositionKind(linePrefix: string): JsdocPositionKind {
    // Check type position first (more specific pattern)
    if (TYPE_POSITION_RE.test(linePrefix)) {
        return JsdocPositionKind.Type;
    }
    // Check tag position
    if (TAG_POSITION_RE.test(linePrefix)) {
        return JsdocPositionKind.Tag;
    }
    return JsdocPositionKind.None;
}

/**
 * Build JSDoc completion items based on cursor position within a JSDoc line.
 *
 * At tag position (`@` or `@par...`): returns tag completions.
 * At type position (after a type-expecting tag): returns type completions.
 * At other positions: returns nothing.
 *
 * @param types Language-specific type metadata map (e.g., FALLOUT_JSDOC_TYPES or WEIDU_JSDOC_TYPES)
 * @param linePrefix Line text from column 0 up to the cursor position
 * @returns Array of completion items based on position
 */
export function getJsdocCompletions(types: ReadonlyMap<string, TypeMeta>, linePrefix: string): CompletionItem[] {
    const kind = getJsdocPositionKind(linePrefix);
    if (kind === JsdocPositionKind.Tag) {
        return getJsdocTagCompletions();
    }
    if (kind === JsdocPositionKind.Type) {
        return getJsdocTypeCompletions(types);
    }
    return [];
}

/**
 * Build tag completion items.
 * Tags are always at a position where `@` is already typed, so insertText/filterText strip the `@`.
 * Tags expecting a type insert trailing space + re-trigger.
 */
function getJsdocTagCompletions(): CompletionItem[] {
    return [...ALL_JSDOC_TAG_NAMES].map((name) => {
        const expectsType = TAGS_WITH_TYPE.has(name);
        const suffix = expectsType ? " " : "";
        return {
            label: `@${name}`,
            insertText: `${name}${suffix}`,
            filterText: name,
            kind: CompletionItemKind.Keyword,
            detail: TAG_DETAILS.get(name) ?? name,
            ...(expectsType ? { command: RETRIGGER_CMD } : {}),
        };
    });
}

/** Build type completion items from language-specific metadata. */
function getJsdocTypeCompletions(types: ReadonlyMap<string, TypeMeta>): CompletionItem[] {
    return [...types].map(([label, { detail }]) => ({
        label,
        detail,
        kind: CompletionItemKind.TypeParameter,
    }));
}
