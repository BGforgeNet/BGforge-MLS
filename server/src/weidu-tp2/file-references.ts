/**
 * File-reference go-to-definition / Ctrl+Click for WeiDU TP2: the file paths in
 * COPY / COPY_LARGE (`from` field only), COMPILE (`source` + `USING tra`), and INCLUDE.
 *
 * Target model, in WeiDU's own precedence order:
 *  1. Inline heredoc block (`<<<<<<<< label ... >>>>>>>>`): the reference is a symbol defined in the
 *     source, so jump to the label line. Matched by exact string identity - no variable resolution -
 *     and checked FIRST because a defined inline label shadows a same-named file in WeiDU.
 *  2. Filesystem path, only when the target extension is one the extension can display. Resolve
 *     `%MOD_FOLDER%` by WeiDU's own rule (see resolveModContext) and existence-check.
 *  3. A `.tra`/`.msg` whose path still holds a `%var%`: the configured translation directory
 *     (see resolveInTranslationDir).
 *  4. A basename that is unique in the mod, which is what the variable path prefixes real mods use leave
 *     to match on.
 *  5. Otherwise no navigation (unresolvable `%var%`, COPY_EXISTING game resref, opaque binary, absent file).
 *
 * Infinity-Engine only: Fallout uses sslc, not tp2, so `.pro`/`.map` never appear here.
 */

import type { Location } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import * as path from "path";
import * as fs from "fs";
import { uriToPath } from "../uri-utils";
import { SyntaxType } from "./syntax-type";
import { findAncestorOfType, stripStringDelimiters } from "./tree-utils";
import { selfLocation, fileLocation, resolveExisting } from "../shared/path-definition";

/**
 * Extensions the extension can open usefully: the IE binary editor formats, the IE language/text
 * grammars (plus plain text VS Code opens directly), and images VS Code previews. Deliberately NOT
 * `.pro`/`.map` (Fallout-only, never referenced from tp2) or opaque IE binaries (`.bam`/`.wav`/
 * `.are`/...) that have no viewer - a link that opens binary garbage is worse than no link.
 */
const DISPLAYABLE_EXT: ReadonlySet<string> = new Set([
    "itm",
    "spl",
    "eff",
    "cre", // IE binary editor
    "baf",
    "d",
    "2da",
    "tra",
    "tp2",
    "tph",
    "tpa",
    "tpp", // IE language grammars
    "ids",
    "ini",
    "txt", // plain text VS Code opens
    "bmp",
    "png",
    "jpg",
    "jpeg",
    "gif", // VS Code image preview
]);

const COPY_TYPES = new Set([SyntaxType.ActionCopy, SyntaxType.ActionCopyLarge]);
const COMPILE_TYPES = new Set([SyntaxType.ActionCompile]);
const INCLUDE_TYPES = new Set([SyntaxType.ActionInclude]);
// COPY_EXISTING sources are game resrefs (read from the BIFs/override), not workspace files - never
// navigate, but still owned here so the handler's symbol fallback cannot wrong-jump off them.
const RESREF_TYPES = new Set([SyntaxType.ActionCopyExisting, SyntaxType.ActionCopyExistingRegexp]);
const STRING_TYPES = new Set([SyntaxType.TildeString, SyntaxType.DoubleString, SyntaxType.FiveTildeString]);
const FILE_PAIR_TYPES = new Set([SyntaxType.FilePair]);

// Cap the filename-first recursive walk so a huge mod tree cannot stall a definition request.
const FILENAME_SEARCH_BUDGET = 20000;

/**
 * Definition for the file paths in COPY/COMPILE/INCLUDE (and COPY_EXISTING) directives.
 *
 * AUTHORITATIVE for path strings: once the cursor is on a path string of a file directive, this returns
 * non-null so the definition handler (handlers/definition.ts) does not fall through to its bare-word
 * symbol lookup - which would otherwise wrongly jump to a same-named DEFINE_ACTION_FUNCTION. When there
 * is no real target (unresolvable variable, absent file, opaque type, game resref, or the COPY `to`
 * destination), it returns a no-op self-location so navigation stays put instead of jumping wrong.
 *
 * Returns null only when the cursor is NOT on a file-directive path string (so ordinary tokens keep
 * their normal go-to-definition behavior).
 */
export function tryFileReferenceDefinition(
    node: SyntaxNode,
    text: string,
    uri: string,
    traDir?: string,
): Location | null {
    const stringNode = findAncestorOfType(node, STRING_TYPES);
    if (!stringNode) {
        return null;
    }

    const inCopy = findAncestorOfType(node, COPY_TYPES);
    const inNavigable = inCopy ?? findAncestorOfType(node, COMPILE_TYPES) ?? findAncestorOfType(node, INCLUDE_TYPES);
    const inResref = findAncestorOfType(node, RESREF_TYPES);
    if (!inNavigable && !inResref) {
        return null;
    }

    const self = selfLocation(stringNode, uri);

    if (inResref) {
        return self;
    }

    // COPY navigates the source (`from`) only; the `to` field is an install destination.
    if (inCopy) {
        const filePair = findAncestorOfType(node, FILE_PAIR_TYPES);
        const toNode = filePair?.childForFieldName("to");
        if (toNode && stringNode.startIndex >= toNode.startIndex && stringNode.endIndex <= toNode.endIndex) {
            return self;
        }
    }

    const raw = stripStringDelimiters(stringNode.text).trim();
    if (!raw) {
        return self;
    }

    // 1. Inline heredoc block (checked first - a defined inline label shadows a same-named file).
    const heredocLine = findHeredocLabelLine(text, raw);
    if (heredocLine !== null) {
        return { uri, range: { start: { line: heredocLine, character: 0 }, end: { line: heredocLine, character: 0 } } };
    }
    // Resolved once and shared by both resolvers below: it walks ancestor directories to find the
    // governing tp2 and reads that tp2 off disk, which neither should pay for twice per request.
    const modContext = resolveModContext(uriToPath(uri));

    // 2. Precise resolution: %MOD_FOLDER% + displayable extension + existence against WeiDU's bases.
    const precise = resolveAsFile(raw, uri, modContext);
    if (precise) {
        return precise;
    }
    // 3. Configured translation directory: a `%LANGUAGE%` path's basename exists once per language, so the
    // unique-match step below declines it. The workspace has already named the language it means.
    const byTraDir = resolveInTranslationDir(raw, traDir);
    if (byTraDir) {
        return byTraDir;
    }
    // 4. Filename-first: real mods parameterize path prefixes with mutable OUTER_SPRINT/OUTER_SET user
    // variables that have no reliable static value, but the basename is literal - search the mod for it.
    const byName = resolveByBasename(raw, uri, modContext);
    if (byName) {
        return byName;
    }
    // 5. Recognized path with no resolvable target: no-op, but authoritative (suppresses the wrong jump).
    return self;
}

/** SYNC: translation/loader.ts `extensions` - the file types the translation directory holds. */
const TRANSLATION_EXT: ReadonlySet<string> = new Set(["tra", "msg"]);

/**
 * Resolve a variable-pathed translation reference (`mymod/tra/%LANGUAGE%/x.tra`) inside the tra directory
 * the workspace configured for `@N` resolution, so navigation and the `@N` hover agree on which language
 * they mean. Unset, or the file is not there: null, and the caller declines rather than picking a language.
 *
 * Requires an unresolved `%var%` and a translation extension. A literal path is resolved on its own terms
 * above - redirecting one here would send a click on `tra/german/x.tra` into english - and the setting names
 * the translation directory only, so it licenses nothing else.
 */
function resolveInTranslationDir(raw: string, traDir: string | undefined): Location | null {
    if (traDir === undefined) {
        return null;
    }
    const p = raw.replaceAll("\\", "/");
    if (!p.includes("%")) {
        return null;
    }
    const base = p.split("/").pop() ?? "";
    if (!base || base.includes("%")) {
        return null;
    }
    if (!TRANSLATION_EXT.has(path.extname(base).slice(1).toLowerCase())) {
        return null;
    }
    const resolved = resolveExisting(path.join(traDir, base));
    return resolved ? fileLocation(resolved) : null;
}

/**
 * Resolve by the literal basename: search the mod tree for a file with that name. A unique match is the
 * target; 0 or >1 matches yield null (we never guess a single wrong target when the name is ambiguous).
 * This sidesteps variable path prefixes entirely - only the filename, which is literal, has to match.
 *
 * Rooted at the MOD folder, which is what "the mod tree" means in both WeiDU layouts. With the tp2 inside
 * the mod folder its directory already IS that root; with the tp2 beside it, the tp2's directory is the
 * game dir, and rooting there walked the whole install - every other mod and every override - on each
 * request, while letting an unrelated mod's same-named file count as a rival and defeat the match.
 */
function resolveByBasename(raw: string, uri: string, ctx: ModContext | null): Location | null {
    const base = raw.replaceAll("\\", "/").split("/").pop() ?? "";
    if (!base || base.includes("%")) {
        return null; // the filename itself is a variable
    }
    const ext = path.extname(base).slice(1).toLowerCase();
    if (!DISPLAYABLE_EXT.has(ext)) {
        return null;
    }
    const currentFilePath = uriToPath(uri);
    const modRoot = ctx?.modFolder ? path.join(ctx.gameDir, ctx.modFolder) : null;
    // Fall back to the file's own directory only when no tp2 governs it at all - there is no mod tree
    // to speak of then, and the file's neighbours are the best available scope.
    const root = modRoot ?? (ctx ? ctx.gameDir : path.dirname(currentFilePath));
    const matches: string[] = [];
    findByBasename(root, base.toLowerCase(), matches, { count: 0 });
    if (matches.length === 1) {
        const only = matches[0];
        if (only) {
            return fileLocation(only);
        }
    }
    return null;
}

/** Bounded recursive search collecting files whose basename matches (case-insensitive); stops at 2. */
function findByBasename(dir: string, wantLower: string, out: string[], budget: { count: number }): void {
    if (out.length > 1 || budget.count > FILENAME_SEARCH_BUDGET) {
        return;
    }
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const e of entries) {
        budget.count++;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            findByBasename(full, wantLower, out, budget);
        } else if (e.name.toLowerCase() === wantLower) {
            out.push(full);
        }
        if (out.length > 1 || budget.count > FILENAME_SEARCH_BUDGET) {
            return;
        }
    }
}

/** Line of a same-file `<<<<<<<< label` block whose label equals `raw` (case-insensitive), or null. */
function findHeredocLabelLine(text: string, raw: string): number | null {
    const target = raw.toLowerCase();
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
        const m = /^<<<<<<<<[ \t]*(\S+)/.exec(line);
        if (m?.[1]?.toLowerCase() === target) {
            return i;
        }
    }
    return null;
}

/**
 * Resolve `raw` as a filesystem path: substitute the derivable `%MOD_FOLDER%`, bail on any remaining
 * `%var%`, gate on a displayable extension, then existence-check (case-insensitive) against WeiDU's
 * resolution bases.
 */
function resolveAsFile(raw: string, uri: string, ctx: ModContext | null): Location | null {
    const currentFilePath = uriToPath(uri);
    let p = raw.replaceAll("\\", "/").trim();

    if (ctx?.modFolder) {
        p = p.replaceAll(/%MOD_FOLDER%/gi, ctx.modFolder);
    }
    p = p.replaceAll(/%TP2_FILE_NAME%/gi, path.basename(currentFilePath));
    if (p.includes("%")) {
        return null; // unresolvable user variable - do not guess
    }

    const ext = path.extname(p).slice(1).toLowerCase();
    if (!DISPLAYABLE_EXT.has(ext)) {
        return null;
    }

    // WeiDU resolves COPY/COMPILE paths from the game dir (its cwd); fall back to the current file's
    // dir and the mod folder to tolerate how the workspace happens to be rooted.
    const bases: string[] = [];
    if (ctx?.gameDir) bases.push(ctx.gameDir);
    bases.push(path.dirname(currentFilePath));
    if (ctx?.gameDir && ctx?.modFolder) bases.push(path.join(ctx.gameDir, ctx.modFolder));

    for (const base of bases) {
        const resolved = resolveExisting(path.resolve(base, p));
        if (resolved) {
            return fileLocation(resolved);
        }
    }
    return null;
}

interface ModContext {
    /** The `%MOD_FOLDER%` value, or null when it cannot be determined. */
    modFolder: string | null;
    /** The directory COPY/COMPILE paths resolve against (WeiDU cwd analogue). */
    gameDir: string;
}

/**
 * Resolve `%MOD_FOLDER%` and the path-resolution base by WeiDU's own rule: the tp2's parent directory
 * when its name matches the tp2's own, otherwise the first segment of the tp2's BACKUP path.
 * The tp2 may live INSIDE the mod folder (`mymod/mymod.tp2`) or BESIDE it (`setup-mymod.tp2` at the
 * game root), so MOD_FOLDER is not simply the tp2's directory. It is governed by the main tp2, which
 * we approximate by the nearest ancestor `.tp2` (constant across nested `.tph`/`.tpa` includes).
 */
function resolveModContext(filePath: string): ModContext | null {
    const tp2Path = findGoverningTp2(filePath);
    if (!tp2Path) {
        return null;
    }
    const base = modBaseName(path.basename(tp2Path));
    const parentDir = path.dirname(tp2Path);
    const parentName = path.basename(parentDir);
    if (parentName.toLowerCase() === base.toLowerCase()) {
        // tp2 inside the mod folder: MOD_FOLDER = parent, resolve from the parent's parent.
        return { modFolder: parentName, gameDir: path.dirname(parentDir) };
    }
    // tp2 beside the mod folder: MOD_FOLDER = first segment of the BACKUP directive; resolve from the
    // tp2's own directory.
    const backupSeg = readBackupSegment(tp2Path);
    return { modFolder: backupSeg, gameDir: parentDir };
}

/** Nearest ancestor directory containing a `.tp2`, returning that tp2's path (bounded walk). */
function findGoverningTp2(filePath: string): string | null {
    let dir = path.dirname(filePath);
    for (let i = 0; i < 16; i++) {
        let entries: string[];
        try {
            entries = fs.readdirSync(dir);
        } catch {
            return null;
        }
        const tp2 = entries.find((e) => e.toLowerCase().endsWith(".tp2"));
        if (tp2) {
            return path.join(dir, tp2);
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            return null;
        }
        dir = parent;
    }
    return null;
}

/** tp2 filename -> mod base-name: strip a leading `setup-` and the `.tp2` extension. */
function modBaseName(filename: string): string {
    const noExt = filename.replace(/\.tp2$/i, "");
    const parts = noExt.split("-");
    if (parts.length > 1 && (parts[0] ?? "").toUpperCase() === "SETUP") {
        return parts.slice(1).join("-");
    }
    return noExt;
}

/** First path segment of the tp2's `BACKUP ~<seg>/...~` directive, or null. */
function readBackupSegment(tp2Path: string): string | null {
    let raw: string;
    try {
        raw = fs.readFileSync(tp2Path, "latin1");
    } catch {
        return null;
    }
    const stripped = raw.replaceAll(/\/\*[\s\S]*?\*\//g, " ").replaceAll(/\/\/[^\n]*/g, " ");
    const backup = /\bBACKUP\b\s*[~"]([^~"]+)[~"]/i.exec(stripped)?.[1];
    if (!backup) {
        return null;
    }
    return backup.replaceAll("\\", "/").split("/")[0] || null;
}
