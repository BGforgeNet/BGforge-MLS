/**
 * String-aware text machinery for post-processing a bundler's output.
 *
 * The bundler emits one ESM module whose imports the transpilers cannot read: cross-file identifiers
 * arrive renamed to avoid collisions, and the import declarations themselves are not statements any
 * downstream emitter understands. These passes undo both, plus the marker prefix the caller prepended
 * to find where its own code starts.
 *
 * The walkers are regex plus hand-rolled tokenization rather than a real parser: bundler output has no
 * regex literals and no exotic syntax, which is what makes skipping strings and comments sufficient.
 */

import { lineCount } from "./line-map";

/**
 * Strip the marker prefix from a bundle and undo the bundler's collision renaming.
 *
 * A bundler renames a cross-file identifier when two modules export the same name (See -> See2).
 * This function:
 * 1. Strips everything before the marker (runtime helpers like __defProp, __name)
 * 2. Builds alias map from import statements (regex)
 * 3. Detects collision patterns (name2 -> name22)
 * 4. Removes import declarations
 * 5. Renames identifiers back to originals (string-aware, skips string literals)
 *
 * @param code Bundled code
 * @param marker Marker string to find start of user code
 * @returns Cleaned code
 */
export function cleanupBundleOutput(
    code: string,
    marker: string,
    /**
     * Filled, when passed, with the 0-based input line each output line came from. Reported rather than
     * returned so the existing call sites keep their `string` return; only a caller tracing a position
     * back through the bundle asks for it.
     */
    survivors?: number[],
): string {
    // Step 1: Strip everything before marker
    const markerIndex = code.indexOf(marker);
    // Lines the prefix strip consumes. Every later line index is stated relative to the ORIGINAL input,
    // so this offset is added back at the end rather than tracked through each step.
    let droppedAhead = 0;
    if (markerIndex !== -1) {
        const afterMarker = code.substring(markerIndex + marker.length);
        const lead = afterMarker.length - afterMarker.trimStart().length;
        droppedAhead = lineCount(code.substring(0, markerIndex + marker.length + lead));
        code = afterMarker.trimStart();
    }

    // Step 2: Extract import aliases via regex
    // Matches: import { name as alias, name2 as alias2 } from "...";
    const aliasMap = new Map<string, string>();
    const importRegex = /^import\s*\{[^}]*\}\s*from\s*"[^"]*"\s*;?\s*$/gm;
    let importMatch;
    while ((importMatch = importRegex.exec(code)) !== null) {
        const specifiers = importMatch[0];
        const asRegex = /(\w+)\s+as\s+(\w+)/g;
        let asMatch;
        while ((asMatch = asRegex.exec(specifiers)) !== null) {
            // Groups 1 and 2 are guaranteed by the regex pattern
            aliasMap.set(asMatch[2]!, asMatch[1]!);
        }
    }

    // Step 3: Detect the bundler's collision avoidance
    // If alias See2 exists and identifier See22 exists in code -> See22->See2
    const allIdentifiers = new Set<string>();
    forEachCodeSegment(code, (segment) => {
        const wordRegex = /\b[A-Za-z_$]\w*\b/g;
        let m;
        while ((m = wordRegex.exec(segment)) !== null) {
            allIdentifiers.add(m[0]);
        }
    });

    for (const [alias] of aliasMap) {
        for (const id of allIdentifiers) {
            if (id.startsWith(alias) && id !== alias && /^\d+$/.test(id.slice(alias.length))) {
                if (!aliasMap.has(id)) {
                    aliasMap.set(id, alias);
                    aliasMap.delete(alias);
                }
            }
        }
    }

    // Step 4: Remove import declarations (single-line and multi-line)
    const importDecl = /^import\s*\{[^}]*\}\s*from\s*"[^"]*"\s*;?[^\S\n]*\n?/gm;
    // The ranges are read off the same matches the removal uses, before it runs: deriving them from the
    // result instead would have to re-identify lines by content, which step 5's renaming then breaks.
    const removed = new Set<number>();
    if (survivors !== undefined) {
        for (const match of code.matchAll(importDecl)) {
            const from = lineCount(code.substring(0, match.index));
            // A match that swallowed its newline vacates exactly the lines it spans. One at end-of-input
            // has no newline to swallow and leaves an empty last line, which collapses into the trailing
            // newline every other line already ends with - so it vacates one line more.
            const span = match[0].endsWith("\n") ? lineCount(match[0]) : lineCount(match[0]) + 1;
            for (let line = from; line < from + span; line++) removed.add(line);
        }
        const total = lineCount(code);
        for (let line = 0; line < total; line++) {
            if (!removed.has(line)) survivors.push(droppedAhead + line);
        }
    }
    code = code.replaceAll(importDecl, "");

    // Step 5: Rename identifiers (string-aware, skips string literals and comments)
    if (aliasMap.size > 0) {
        // Sort by length (longest first) to avoid partial replacements
        const sorted = [...aliasMap.entries()].sort((a, b) => b[0].length - a[0].length);

        const pattern = new RegExp("\\b(" + sorted.map(([alias]) => escapeRegex(alias)).join("|") + ")\\b", "g");

        code = replaceOutsideStrings(code, pattern, (match) => aliasMap.get(match) ?? match);
    }

    return code;
}

/**
 * Iterate over segments of code that are NOT inside string literals or comments.
 * Used for collecting identifiers safely.
 */
export function forEachCodeSegment(code: string, fn: (segment: string) => void): void {
    let i = 0;
    let segStart = 0;
    while (i < code.length) {
        const ch = code[i];
        if (ch === '"' || ch === "'") {
            if (i > segStart) fn(code.substring(segStart, i));
            i = skipString(code, i);
            segStart = i;
        } else if (ch === "`") {
            if (i > segStart) fn(code.substring(segStart, i));
            i = skipTemplateLiteral(code, i);
            segStart = i;
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "/") {
            if (i > segStart) fn(code.substring(segStart, i));
            while (i < code.length && code[i] !== "\n") i++;
            segStart = i;
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "*") {
            if (i > segStart) fn(code.substring(segStart, i));
            i = skipBlockComment(code, i);
            segStart = i;
        } else {
            i++;
        }
    }
    if (i > segStart) fn(code.substring(segStart, i));
}

/**
 * Replace regex matches in code, but only outside string literals and comments.
 * Strings (single/double/template) and comments (line/block) are copied verbatim.
 * Safe for bundler output, which has no regex literals.
 */
export function replaceOutsideStrings(code: string, pattern: RegExp, replacer: (match: string) => string): string {
    let result = "";
    let i = 0;
    while (i < code.length) {
        const ch = code[i];

        // Pass through string/template/comment spans verbatim; only code spans
        // get the replacer applied.
        let end: number;
        let isCode = false;
        if (ch === '"' || ch === "'") {
            end = skipString(code, i);
        } else if (ch === "`") {
            end = skipTemplateLiteral(code, i);
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "/") {
            end = i;
            while (end < code.length && code[end] !== "\n") end++;
        } else if (ch === "/" && i + 1 < code.length && code[i + 1] === "*") {
            end = skipBlockComment(code, i);
        } else {
            // Accumulate code until next string/comment boundary
            end = i;
            while (end < code.length) {
                const c = code[end];
                if (c === '"' || c === "'" || c === "`") break;
                if (c === "/" && end + 1 < code.length && (code[end + 1] === "/" || code[end + 1] === "*")) break;
                end++;
            }
            isCode = true;
        }

        const segment = code.substring(i, end);
        result += isCode ? segment.replace(pattern, replacer) : segment;
        i = end;
    }
    return result;
}

/** Skip past a quoted string (single or double). Returns index after closing quote. */
export function skipString(code: string, start: number): number {
    const quote = code[start];
    let i = start + 1;
    while (i < code.length) {
        if (code[i] === "\\") {
            i += 2;
            continue;
        }
        if (code[i] === quote) return i + 1;
        i++;
    }
    return i;
}

/** Skip past a template literal. Returns index after closing backtick. */
export function skipTemplateLiteral(code: string, start: number): number {
    let i = start + 1;
    while (i < code.length) {
        if (code[i] === "\\") {
            i += 2;
            continue;
        }
        if (code[i] === "`") return i + 1;
        if (code[i] === "$" && i + 1 < code.length && code[i + 1] === "{") {
            // Template expression - scan for matching }, handling nested strings/templates
            i += 2;
            let braceDepth = 1;
            while (i < code.length && braceDepth > 0) {
                if (code[i] === "{") braceDepth++;
                else if (code[i] === "}") braceDepth--;
                else if (code[i] === '"' || code[i] === "'") {
                    i = skipString(code, i);
                    continue;
                } else if (code[i] === "`") {
                    i = skipTemplateLiteral(code, i);
                    continue;
                }
                i++;
            }
            continue;
        }
        i++;
    }
    return i;
}

/** Skip past a block comment. Returns index after closing `* /`. */
export function skipBlockComment(code: string, start: number): number {
    const end = code.indexOf("*/", start + 2);
    return end === -1 ? code.length : end + 2;
}

function escapeRegex(s: string): string {
    return s.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
