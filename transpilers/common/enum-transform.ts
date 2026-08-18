/**
 * Enum transformation for TSSL and TBAF/TD transpilers.
 *
 * Transforms TypeScript enum declarations into flat const declarations before
 * esbuild bundling. This avoids esbuild's IIFE conversion of enums, which
 * neither transpiler can handle.
 *
 * EnumName.Member -> EnumName_Member (prefixed naming)
 */

import * as fs from "fs";
import type * as esbuild from "esbuild-wasm";
import { SyntaxKind, type EnumDeclaration, type SourceFile } from "ts-morph";
import { getSharedProject } from "./shared-project";
import { lineCount, survivorsFromEdits, type LineEdit } from "./line-map";

/** Result of transforming enums in source text */
interface EnumTransformResult {
    /** Transformed source code (unchanged if no enums found) */
    readonly code: string;
    /** Set of enum names found and transformed */
    readonly enumNames: ReadonlySet<string>;
}

/**
 * Transform enum declarations into flat const declarations.
 *
 * For each enum:
 * 1. Generates `const EnumName_Member = value;` for each member
 * 2. Generates `const EnumName = { Member: value, ... } as const;` (compat object)
 * 3. Replaces `EnumName.Member` property accesses with `EnumName_Member`
 *
 * @param sourceText TypeScript source text
 * @returns Transformed code and set of enum names
 */
export function transformEnums(sourceText: string, survivors?: number[]): EnumTransformResult {
    /** Every line unchanged, for the paths that rewrite nothing. */
    const reportIdentity = () => {
        if (survivors === undefined) return;
        for (let line = 0; line < lineCount(sourceText); line++) survivors.push(line);
    };

    // Fast path: no enums in source
    if (!sourceText.includes("enum ")) {
        reportIdentity();
        return { code: sourceText, enumNames: new Set() };
    }

    const project = getSharedProject();
    const sourceFile = project.createSourceFile("enum-transform.ts", sourceText, { overwrite: true });

    const enumDecls = sourceFile.getEnums();

    // Fast path: enum keyword found in text but no actual enum declarations
    if (enumDecls.length === 0) {
        reportIdentity();
        return { code: sourceText, enumNames: new Set() };
    }

    // Collect enum info before modifying AST
    const enumInfos = collectEnumInfo(enumDecls);

    // Replace enum declarations with flat consts (in reverse to preserve positions)
    const edits: LineEdit[] = [];
    replaceEnumDeclarations(enumDecls, enumInfos, edits);
    // The property-access rewrite below stays on one line, so these are the only lines that moved.
    if (survivors !== undefined) survivors.push(...survivorsFromEdits(edits, lineCount(sourceText)));

    // After replaceEnumDeclarations, individual enum nodes are stale but the
    // sourceFile itself remains valid. getDescendantsOfKind re-walks the current tree.
    replaceEnumPropertyAccesses(sourceFile, enumInfos);

    const enumNames = new Set(enumInfos.map((e) => e.name));
    return { code: sourceFile.getFullText(), enumNames };
}

/** Collected info about a single enum */
interface EnumInfo {
    readonly name: string;
    readonly isExported: boolean;
    readonly members: ReadonlyArray<{ readonly name: string; readonly value: string }>;
}

/**
 * Collect enum names, members, and values before modifying the AST.
 * Skips `declare enum` declarations.
 */
function collectEnumInfo(enumDecls: readonly EnumDeclaration[]): readonly EnumInfo[] {
    const infos: EnumInfo[] = [];

    for (const enumDecl of enumDecls) {
        // Skip declare enum (ambient declarations)
        if (enumDecl.hasDeclareKeyword()) {
            continue;
        }

        const name = enumDecl.getName();
        const isExported = enumDecl.isExported();
        const members: Array<{ name: string; value: string }> = [];

        for (const member of enumDecl.getMembers()) {
            const memberName = member.getName();
            const value = member.getValue();

            if (value === undefined) {
                // Should not happen with ts-morph's auto-increment, but handle gracefully
                members.push({ name: memberName, value: "0" });
            } else if (typeof value === "string") {
                members.push({ name: memberName, value: JSON.stringify(value) });
            } else {
                members.push({ name: memberName, value: String(value) });
            }
        }

        infos.push({ name, isExported, members });
    }

    return infos;
}

/**
 * Replace each enum declaration with flat const declarations and a compat object.
 * Processes in reverse order to preserve source positions.
 */
function replaceEnumDeclarations(
    enumDecls: readonly EnumDeclaration[],
    enumInfos: readonly EnumInfo[],
    /** Filled, when passed, with what each rewrite did to the line count. */
    edits?: LineEdit[],
): void {
    // Build a map from enum name to info for lookup
    const infoByName = new Map(enumInfos.map((e) => [e.name, e]));

    // Process in reverse to preserve positions
    for (let i = enumDecls.length - 1; i >= 0; i--) {
        const enumDecl = enumDecls[i]!;
        const info = infoByName.get(enumDecl.getName());

        if (!info) {
            // This is a declare enum - skip
            continue;
        }

        const exportPrefix = info.isExported ? "export " : "";
        const lines: string[] = [];

        // Flat const per member
        for (const member of info.members) {
            lines.push(`${exportPrefix}const ${info.name}_${member.name} = ${member.value};`);
        }

        // Compat object for cross-file imports
        if (info.members.length > 0) {
            const entries = info.members.map((m) => `${m.name}: ${m.value}`).join(", ");
            lines.push(`${exportPrefix}const ${info.name} = { ${entries} } as const;`);
        } else {
            lines.push(`${exportPrefix}const ${info.name} = {} as const;`);
        }

        // Recorded before the rewrite and while walking in reverse, so these are still the declaration's
        // original line numbers - every edit so far was made below it.
        edits?.push({
            startLine: enumDecl.getStartLineNumber() - 1,
            inputSpan: enumDecl.getEndLineNumber() - enumDecl.getStartLineNumber() + 1,
            outputSpan: lines.length,
        });
        enumDecl.replaceWithText(lines.join("\n"));
    }
}

/**
 * Replace all `EnumName.Member` property accesses with `EnumName_Member`.
 * Only matches direct Identifier.property patterns (not nested like Obj.Enum.Member).
 */
function replaceEnumPropertyAccesses(sourceFile: SourceFile, enumInfos: readonly EnumInfo[]): void {
    // Build lookup: enum name -> set of member names
    const memberLookup = new Map<string, Set<string>>();
    for (const info of enumInfos) {
        memberLookup.set(info.name, new Set(info.members.map((m) => m.name)));
    }

    // Find and replace property accesses
    // Process in reverse to preserve positions
    const accesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
    for (let i = accesses.length - 1; i >= 0; i--) {
        const access = accesses[i]!;
        const expr = access.getExpression();

        // Only match direct identifier access (not chained like a.b.c)
        if (!expr.isKind(SyntaxKind.Identifier)) {
            continue;
        }

        const objName = expr.getText();
        const propName = access.getName();
        const members = memberLookup.get(objName);

        if (members && members.has(propName)) {
            access.replaceWithText(`${objName}_${propName}`);
        }
    }
}

/**
 * Expand enum compat objects in post-bundled code.
 *
 * After esbuild bundles cross-file imports, enum compat objects appear as
 * variable declarations with object literal initializers.
 *
 * This function:
 * 1. Replaces those var/let/const statements with individual `var EnumName_Member = value;`
 * 2. Replaces remaining `EnumName.Member` property accesses with `EnumName_Member`
 * 3. For externalized enums (from .d.ts files), strips the enum prefix:
 *    `ClassID.ANKHEG` -> `ANKHEG` (keeps symbolic name for the game engine)
 *
 * @param code Post-bundled code from esbuild
 * @param enumNames Set of bundled enum names to look for (have compat objects)
 * @param externalEnumNames Set of externalized enum names from .d.ts files
 *   (no compat objects - prefix is stripped instead of replaced with underscore)
 * @returns Expanded code
 */
export function expandEnumPropertyAccess(
    code: string,
    enumNames: ReadonlySet<string>,
    externalEnumNames: ReadonlySet<string> = new Set(),
    /**
     * Filled, when passed, with the 0-based input line each output line came from. Reported rather than
     * returned so existing call sites keep their `string` return; only a caller tracing a position back
     * through the bundle asks for it.
     */
    survivors?: number[],
): string {
    /** Every line unchanged, for the paths that rewrite nothing or nothing line-bearing. */
    const reportIdentity = (text: string) => {
        if (survivors === undefined) return;
        for (let line = 0; line < lineCount(text); line++) survivors.push(line);
    };

    // Fast path: nothing to expand
    if (enumNames.size === 0 && externalEnumNames.size === 0) {
        reportIdentity(code);
        return code;
    }

    const project = getSharedProject();
    const sourceFile = project.createSourceFile("expand-enum.ts", code, { overwrite: true });

    // First pass: collect which enum members are actually referenced as EnumName.Member
    const referencedMembers = new Map<string, Set<string>>();
    for (const access of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
        const expr = access.getExpression();
        if (!expr.isKind(SyntaxKind.Identifier)) {
            continue;
        }
        const objName = expr.getText();
        if (!enumNames.has(objName)) {
            continue;
        }
        if (!referencedMembers.has(objName)) {
            referencedMembers.set(objName, new Set());
        }
        referencedMembers.get(objName)!.add(access.getName());
    }

    const expandedInfos: EnumInfo[] = [];
    // What each rewritten statement did to the line count. Recorded during the loop below because it
    // walks statements in REVERSE, so a statement's line numbers are still its original ones when it is
    // reached - every edit so far was made after it.
    const edits: Array<{ startLine: number; inputSpan: number; outputSpan: number }> = [];
    const spanOf = (stmt: { getStartLineNumber(): number; getEndLineNumber(): number }) => ({
        startLine: stmt.getStartLineNumber() - 1,
        inputSpan: stmt.getEndLineNumber() - stmt.getStartLineNumber() + 1,
    });

    // Second pass: find compat object declarations and replace with only referenced members
    const stmts = sourceFile.getStatements();
    for (let i = stmts.length - 1; i >= 0; i--) {
        const stmt = stmts[i]!;
        if (!stmt.isKind(SyntaxKind.VariableStatement)) {
            continue;
        }

        const varStmt = stmt.asKind(SyntaxKind.VariableStatement)!;
        const decls = varStmt.getDeclarationList().getDeclarations();

        // Only handle single-declaration statements to avoid destroying sibling vars.
        // esbuild always outputs one var per statement, so this is safe.
        if (decls.length !== 1) {
            continue;
        }

        const decl = decls[0]!;
        const name = decl.getName();
        if (!enumNames.has(name)) {
            continue;
        }

        const init = decl.getInitializer();
        if (!init || !init.isKind(SyntaxKind.ObjectLiteralExpression)) {
            continue;
        }

        const usedMembers = referencedMembers.get(name);

        // No members referenced - remove the compat object entirely
        if (!usedMembers || usedMembers.size === 0) {
            edits.push({ ...spanOf(varStmt), outputSpan: 0 });
            varStmt.remove();
            continue;
        }

        const objLiteral = init.asKind(SyntaxKind.ObjectLiteralExpression)!;
        const members: Array<{ name: string; value: string }> = [];

        for (const prop of objLiteral.getProperties()) {
            if (prop.isKind(SyntaxKind.PropertyAssignment)) {
                const propAssign = prop.asKind(SyntaxKind.PropertyAssignment)!;
                const memberName = propAssign.getName();
                // Only include members that are actually referenced
                if (!usedMembers.has(memberName)) {
                    continue;
                }
                const memberInit = propAssign.getInitializer();
                if (memberInit) {
                    members.push({ name: memberName, value: memberInit.getText() });
                }
            }
        }

        expandedInfos.push({ name, isExported: false, members });

        // Replace var statement with individual declarations for referenced members only
        const lines = members.map((m) => `var ${name}_${m.name} = ${m.value};`);
        // No members left to write still leaves the statement's line behind, empty, rather than closing it.
        edits.push({ ...spanOf(varStmt), outputSpan: Math.max(1, lines.length) });
        varStmt.replaceWithText(lines.join("\n"));
    }

    // Replace property accesses for expanded enums
    if (expandedInfos.length > 0) {
        replaceEnumPropertyAccesses(sourceFile, expandedInfos);
    }

    // Strip prefix for externalized enums (declare enum from .d.ts files).
    // These have no compat object in the bundled code - just bare Enum.Member
    // property accesses that need to become bare Member identifiers.
    if (externalEnumNames.size > 0) {
        stripExternalEnumPrefixes(sourceFile, externalEnumNames);
    }

    // Both passes above rewrite a property access into an identifier in place, so only the statement
    // rewrites recorded above moved any line.
    if (survivors !== undefined) survivors.push(...survivorsFromEdits(edits, lineCount(code)));

    return sourceFile.getFullText();
}

/**
 * Strip enum prefix from externalized enum property accesses.
 * `ClassID.ANKHEG` -> `ANKHEG` (keeps the symbolic member name for the game engine).
 *
 * Externalized enums come from `declare enum` in .d.ts files. esbuild drops them
 * entirely, leaving bare `Enum.Member` property accesses in the output. Unlike
 * bundled enums (which get `Enum_Member = value` flat vars), externalized enums
 * need to keep the symbolic name - the game engine resolves them at runtime.
 */
function stripExternalEnumPrefixes(sourceFile: SourceFile, externalEnumNames: ReadonlySet<string>): void {
    const accesses = sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression);
    for (let i = accesses.length - 1; i >= 0; i--) {
        const access = accesses[i]!;
        const expr = access.getExpression();

        if (!expr.isKind(SyntaxKind.Identifier)) {
            continue;
        }

        const objName = expr.getText();
        if (externalEnumNames.has(objName)) {
            // Strip prefix: ClassID.ANKHEG -> ANKHEG
            access.replaceWithText(access.getName());
        }
    }
}

/**
 * Extract `declare enum` names from a .d.ts file's content.
 * Uses a regex since `declare enum X {` is a well-defined pattern.
 *
 * @param text Content of a .d.ts file
 * @returns Array of declared enum names (empty if none found)
 */
export function extractDeclareEnumNames(text: string): readonly string[] {
    if (!text.includes("enum ")) {
        return [];
    }
    const names: string[] = [];
    const regex = /\bdeclare\s+(?:const\s+)?enum\s+(\w+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const name = match[1];
        if (name) names.push(name);
    }
    return names;
}

/**
 * Read a .d.ts file and add any `declare enum` names to the target set.
 * Silently ignores read errors (file may not exist on disk if it's a virtual path).
 *
 * @param filePath Resolved absolute path to the .d.ts file
 * @param target Mutable set to add enum names to
 */
export function collectDeclareEnums(filePath: string, target: Set<string>): void {
    let content: string;
    try {
        content = fs.readFileSync(filePath, "utf-8");
    } catch {
        return;
    }
    for (const name of extractDeclareEnumNames(content)) {
        target.add(name);
    }
}

/**
 * Resolve an import specifier to an actual .d.ts file path on disk.
 *
 * TypeScript allows omitting `.ts` in import specifiers, so esbuild's
 * `args.path` may arrive as `./class.ids.d` for an actual `class.ids.d.ts` file.
 * This function tries the path as-is first, then with `.ts` appended.
 *
 * @param basePath Absolute path derived from resolveDir + import specifier
 * @returns Resolved path, or the original path if neither variant exists
 */
export function resolveDtsPath(basePath: string): string {
    if (fs.existsSync(basePath)) return basePath;
    if (!basePath.endsWith(".ts") && fs.existsSync(basePath + ".ts")) return basePath + ".ts";
    return basePath;
}

/**
 * Create an esbuild plugin that transforms enums in loaded files.
 * Accumulates discovered enum names into the provided mutable set.
 *
 * @param allEnumNames Mutable set to accumulate enum names into.
 *   Mutated via closure because esbuild's plugin API provides no other way
 *   to communicate data back to the caller.
 * @param filter File filter regex for the onLoad handler
 * @returns esbuild plugin
 */
export function enumTransformPlugin(allEnumNames: Set<string>, filter: RegExp): esbuild.Plugin {
    return {
        name: "enum-transform",
        setup(build: esbuild.PluginBuild) {
            build.onLoad({ filter }, (args: esbuild.OnLoadArgs) => {
                // Skip .d.ts files (type declarations, not user code)
                if (args.path.endsWith(".d.ts")) {
                    return null;
                }
                let source: string;
                try {
                    source = fs.readFileSync(args.path, "utf-8");
                } catch {
                    // Unreadable path (e.g. a virtual module esbuild resolved with no on-disk
                    // file): skip the transform and let esbuild's default loader handle it.
                    return null;
                }
                if (!source.includes("enum ")) {
                    return null;
                }
                const { code, enumNames: importedEnums } = transformEnums(source);
                for (const name of importedEnums) {
                    allEnumNames.add(name);
                }
                return { contents: code, loader: "ts" };
            });
        },
    };
}
