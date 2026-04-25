/**
 * JSDoc comment parser.
 * Extracts @param, @return, @deprecated, @type tags from documentation comments.
 *
 * Supported types: array, bool, ids, int, list, map, resref, string, filename
 *
 * Supported tags:
 *   @param {type} name - description        Basic parameter
 *   @param {type} name! - description       Required parameter (hides default in hover)
 *   @param {type} [name=default] - desc     Parsed but default is ignored (see note)
 *   @return {type}                          Unnamed return (Fallout SSL procedures)
 *   @return {type} name - description       Named return (WeiDU RET/RET_ARRAY vars, named mode)
 *   @deprecated                             Mark as deprecated
 *   @deprecated message                     Deprecated with reason
 *   @type {type}                            Variable type annotation
 *
 * Return modes:
 *   'unnamed' (default) — SSL behavior: unnamed @return populates ret field, named goes to rets[].
 *   'named' — TP2 behavior: only type-before-name syntax is recognized, consistent with @param.
 *     Braced: @return {type} name desc. Braceless: @return type name desc (known types only).
 *     All matches go to rets[]. Unnamed ret is never set.
 *
 * Note on defaults:
 *   The [name=default] syntax is parsed for compatibility but the default value is ignored.
 *   Both WeiDU and Fallout SSL get defaults from the AST, so JSDoc defaults are redundant.
 *   Use @param {type} name - description instead.
 */

// ============================================
// Types
// ============================================

/** Parsed parameter info. */
interface Arg {
    name: string;
    type: string;
    description?: string;
    required?: boolean; // True if name ends with ! (e.g., @param {int} count!)
}

/** Parsed return type info. */
export interface Ret {
    name?: string; // For named returns (@return {type} name, named mode only)
    type: string;
    description?: string;
}

/** Complete parsed JSDoc. */
export interface JSdoc {
    desc?: string;
    args: Arg[];
    ret?: Ret; // Unnamed @return {type} (SSL, unnamed mode)
    rets?: Ret[]; // Named returns: @return {type} name desc (TP2, named mode)
    deprecated?: string | true;
    type?: string; // For @type tag (used for variables)
}

/** Options for parse(). */
interface ParseOptions {
    /**
     * How to interpret @return tags.
     * - 'unnamed' (default): SSL behavior — unnamed @return populates ret, named goes to rets[].
     * - 'named': TP2 behavior — all @return tags go to rets[] as named returns. ret is never set.
     */
    returnMode?: "unnamed" | "named";
}

// ============================================
// Regex patterns
// ============================================
// SYNC: Tag names (arg|param, ret|return|returns) must match jsdoc-types.ts canonical lists.
// Validated by type-sync.test.ts.

import { JSDOC_TYPE_PATTERN } from "./jsdoc-types";

/**
 * Pattern for @param/@arg tags with braces.
 * Matches: @param {type} name - description
 *      or: @param {type} name! - description (required)
 *      or: @param {type} [name=default] - description
 *
 * Groups: 1=type, 2=simpleName, 3=requiredMarker(!), 4=bracketName, 5=default, 6=description
 */
const PARAM_PATTERN = /@(?:arg|param)\s+\{(\w+)\}\s+(?:(\w+)(!)?|\[(\w+)=([^\]]+)\])(?:\s+-\s+|\s+)?(.+)?/;

/**
 * Pattern for @param/@arg tags without braces (type must be a known JSDoc type).
 * Matches: @param type name - description
 *      or: @param type name! - description (required)
 *
 * Groups: 1=type, 2=name, 3=requiredMarker(!), 4=description
 */
const PARAM_BRACELESS_PATTERN = new RegExp(
    `@(?:arg|param)\\s+(${JSDOC_TYPE_PATTERN})\\s+(\\w+)(!)?(?:\\s+-\\s+|\\s+)?(.+)?`,
);

/** Pattern for unnamed @return/@returns/@ret tags with braces. Groups: 1=type, 2=description (optional) */
const RETURN_PATTERN = /@(?:ret|return|returns)\s+\{(\w+)\}(?:\s+-\s+|\s+)?(.+)?/;

/**
 * Pattern for unnamed @return/@returns/@ret tags without braces (type must be a known JSDoc type).
 * Groups: 1=type, 2=description (optional)
 */
const RETURN_BRACELESS_PATTERN = new RegExp(
    `@(?:ret|return|returns)\\s+(${JSDOC_TYPE_PATTERN})\\b(?:\\s+-\\s+|\\s+)?(.+)?`,
);

/**
 * Pattern for named @return/@returns/@ret tags with type-before-name (braced).
 * Used in 'named' returnMode for TP2, consistent with @param {type} name syntax.
 * Matches: @return {type} name - description
 *      or: @return {type} name description
 * Groups: 1=type, 2=name, 3=description (optional)
 */
const NAMED_RETURN_TYPE_FIRST_PATTERN = /@(?:ret|return|returns)\s+\{(\w+)\}\s+(\w+)(?:\s+-\s+|\s+)?(.+)?/;

/**
 * Pattern for named @return/@returns/@ret tags with type-before-name (braceless).
 * Type must be a known JSDoc type to disambiguate from arbitrary text.
 * Matches: @return type name - description
 * Groups: 1=type, 2=name, 3=description (optional)
 */
const NAMED_RETURN_TYPE_FIRST_BRACELESS_PATTERN = new RegExp(
    `@(?:ret|return|returns)\\s+(${JSDOC_TYPE_PATTERN})\\s+(\\w+)(?:\\s+-\\s+|\\s+)?(.+)?`,
);

/** Pattern for @deprecated tag. Groups: 1=message (optional) */
const DEPRECATED_PATTERN = /@deprecated(?:\s+(.*))?/;

/** Pattern for @type tag. Groups: 1=type with braces, 2=type without braces, 3=trailing description. */
const TYPE_PATTERN = /@type\s+(?:\{([^}]+)\}|(\w+))(?:\s+-\s+|\s+)?(.+)?/;

/** Valid compound type suffixes after the base type word (e.g., "resref offset", "byte array offset"). */
const COMPOUND_TYPE_SUFFIXES: readonly string[] = ["offset", "array offset"];

/** Pattern for JSDoc line prefix " * " or " *" */
const LINE_PREFIX_PATTERN = /^\s*\*\s?/;

// ============================================
// Parsing functions
// ============================================

/**
 * Parse a JSDoc comment block.
 * @param text Raw comment text including / * * and * /
 * @param options Parse options (returnMode controls how @return tags are interpreted)
 */
export function parse(text: string, options?: ParseOptions): JSdoc {
    const lines = text.split("\n");

    if (lines.length === 1) {
        // Single-line JSDoc: /** content */
        const content = text
            .replace(/^\/\*\*\s*/, "")
            .replace(/\s*\*\/$/, "")
            .trim();
        lines.length = 0;
        if (content) {
            lines.push(content);
        }
    } else {
        // Multi-line: remove first (/**) and last (*/) lines
        lines.shift();
        lines.pop();
    }

    const returnMode = options?.returnMode ?? "unnamed";
    const args: Arg[] = [];
    const rets: Ret[] = [];
    const descriptionLines: string[] = [];
    let ret: Ret | undefined;
    let deprecated: string | true | undefined;
    let type: string | undefined;

    for (const rawLine of lines) {
        const line = rawLine.replace(LINE_PREFIX_PATTERN, "");

        // Skip empty lines in description collection
        if (!line.startsWith("@")) {
            descriptionLines.push(line);
            continue;
        }

        // Try parsing @param
        const paramResult = parseParam(line);
        if (paramResult) {
            args.push(paramResult);
            continue;
        }

        // Parse @return tags — behavior depends on returnMode
        if (returnMode === "named") {
            // Named mode (TP2): only type-before-name braced (@ret {type} name desc),
            // consistent with @param syntax. Unnamed @ret and name-before-type are ignored.
            const namedResult = parseNamedReturnTypeFirst(line);
            if (namedResult) {
                rets.push(namedResult);
                continue;
            }
        } else {
            // Unnamed mode (SSL, default): unnamed returns only, populates ret.
            const returnResult = parseReturn(line);
            if (returnResult) {
                ret = returnResult;
                continue;
            }
        }

        // Try parsing @type (may include trailing description)
        const typeResult = parseType(line);
        if (typeResult) {
            type = typeResult.type;
            if (typeResult.desc) {
                descriptionLines.push(typeResult.desc);
            }
            continue;
        }

        // Try parsing @deprecated
        const deprecatedResult = parseDeprecated(line);
        if (deprecatedResult !== null) {
            deprecated = deprecatedResult;
        }
    }

    // Build result
    const result: JSdoc = { args };
    const desc = descriptionLines.join("\n").trim();
    if (desc) {
        result.desc = desc;
    }
    if (ret) {
        result.ret = ret;
    }
    if (rets.length > 0) {
        result.rets = rets;
    }
    if (type) {
        result.type = type;
    }
    if (deprecated !== undefined) {
        result.deprecated = deprecated;
    }

    return result;
}

/** Parse @param or @arg tag (with or without braces around type). */
function parseParam(line: string): Arg | null {
    // Try braced syntax first: @param {type} name
    const match = line.match(PARAM_PATTERN);
    if (match) {
        // Note: defaultValue (group 5) is parsed but ignored - defaults come from AST
        const [, type, simpleName, requiredMarker, bracketName, , description] = match;
        const name = simpleName || bracketName;

        // Type and name are required
        if (!type || !name) {
            return null;
        }

        const arg: Arg = { name, type };
        if (requiredMarker === "!") {
            arg.required = true;
        }
        if (description) {
            arg.description = description;
        }
        return arg;
    }

    // Try brace-less syntax: @param type name (type must be a known JSDoc type)
    const bracelessMatch = line.match(PARAM_BRACELESS_PATTERN);
    if (!bracelessMatch) {
        return null;
    }

    const [, type, name, requiredMarker, description] = bracelessMatch;
    if (!type || !name) {
        return null;
    }

    const arg: Arg = { name, type };
    if (requiredMarker === "!") {
        arg.required = true;
    }
    if (description) {
        arg.description = description;
    }
    return arg;
}

/** Parse unnamed @return, @returns, or @ret tag (with or without braces). */
function parseReturn(line: string): Ret | null {
    // Try braced syntax first: @ret {type}
    const match = line.match(RETURN_PATTERN);
    if (match && match[1]) {
        const ret: Ret = { type: match[1] };
        if (match[2]) {
            ret.description = match[2].trim();
        }
        return ret;
    }

    // Try brace-less syntax: @ret type (type must be a known JSDoc type)
    const bracelessMatch = line.match(RETURN_BRACELESS_PATTERN);
    if (!bracelessMatch || !bracelessMatch[1]) {
        return null;
    }
    const ret: Ret = { type: bracelessMatch[1] };
    if (bracelessMatch[2]) {
        ret.description = bracelessMatch[2].trim();
    }
    return ret;
}

/**
 * Parse named @return with type-before-name braced syntax (used in 'named' returnMode).
 * Format: @return {type} name - description
 *     or: @return {type} name description
 */
function parseNamedReturnTypeFirst(line: string): Ret | null {
    // Try braced syntax first: @ret {type} name
    const match = line.match(NAMED_RETURN_TYPE_FIRST_PATTERN);
    if (match && match[1] && match[2]) {
        const ret: Ret = { name: match[2], type: match[1] };
        if (match[3]) {
            ret.description = match[3].trim();
        }
        return ret;
    }

    // Try braceless syntax: @ret type name (type must be a known JSDoc type)
    const bracelessMatch = line.match(NAMED_RETURN_TYPE_FIRST_BRACELESS_PATTERN);
    if (!bracelessMatch || !bracelessMatch[1] || !bracelessMatch[2]) {
        return null;
    }
    const ret: Ret = { name: bracelessMatch[2], type: bracelessMatch[1] };
    if (bracelessMatch[3]) {
        ret.description = bracelessMatch[3].trim();
    }
    return ret;
}

/** Parse @type tag. Returns type and optional trailing description, or null if no match.
 * Braced types may be compound: {resref offset}, {byte array offset}, {char array offset}. */
function parseType(line: string): { type: string; desc?: string } | null {
    const match = line.match(TYPE_PATTERN);
    if (!match) {
        return null;
    }
    const raw = match[1] || match[2];
    if (!raw) {
        return null;
    }

    // Braced content may be compound (e.g., "resref offset"). Validate the suffix.
    const trimmed = raw.trim();
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx !== -1) {
        const suffix = trimmed.slice(spaceIdx + 1).trim();
        if (!COMPOUND_TYPE_SUFFIXES.includes(suffix)) {
            return null;
        }
    }

    const desc = match[3]?.trim();
    return { type: trimmed, desc: desc || undefined };
}

/** Parse @deprecated tag. Returns true if no message, string if message, null if no match. */
function parseDeprecated(line: string): string | true | null {
    const match = line.match(DEPRECATED_PATTERN);
    if (!match) {
        return null;
    }
    const message = match[1]?.trim();
    return message || true;
}

// ============================================
// Utility functions
// ============================================

/** Parameter info from JSDoc for display purposes. */
interface ParamDisplayInfo {
    description?: string;
    required?: boolean;
}

/**
 * Build a map of parameter names to their display info (description, required) from JSDoc.
 * Returns empty map if jsdoc or args is undefined/empty.
 */
export function buildParamInfoMap(jsdoc?: JSdoc): Map<string, ParamDisplayInfo> {
    const map = new Map<string, ParamDisplayInfo>();
    if (!jsdoc?.args) {
        return map;
    }
    for (const arg of jsdoc.args) {
        const info: ParamDisplayInfo = {};
        if (arg.description) {
            info.description = arg.description;
        }
        if (arg.required) {
            info.required = true;
        }
        if (info.description || info.required) {
            map.set(arg.name, info);
        }
    }
    return map;
}
