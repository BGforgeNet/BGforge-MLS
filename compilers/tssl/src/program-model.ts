/**
 * The TSSL program model: which modules a compilation unit spans, what each contributes, and what of it
 * is actually reachable - resolved from the TypeScript AST itself.
 *
 * This replaces bundling the sources through a JS bundler and repairing its output by regex. The
 * bundler brought module resolution and tree-shaking, but its output was JavaScript: identifiers
 * renamed around collisions, float literals normalised (`100.0` became `100`, silently turning float
 * division into integer division), JSDoc stripped, and per-file attribution recoverable only from the
 * comments it happened to insert. Resolving modules with the TypeScript checker keeps every fact
 * first-hand: each emitted item is a declaration node that still knows its file, line and source text.
 *
 * The checker's own resolution is used for both module targets and identifiers, because folib is a
 * barrel of named re-exports and its package.json routes through an `exports` map - exactly the two
 * things a hand-rolled resolver gets wrong first.
 */

import {
    Node,
    SyntaxKind,
    ts,
    type EnumDeclaration,
    type FunctionDeclaration,
    type Identifier,
    type Project,
    type SourceFile,
    type VariableDeclaration,
} from "ts-morph";
import { TranspileError } from "../../../transpilers/common/transpile-error";
import type { InlineFunc } from "./types";

/** What one module contributes, in its own statement order. */
export interface ModuleItems {
    /** The file the module's declarations live in - for the entry, the .tssl path the author edits. */
    file: string;
    isEntry: boolean;
    source: SourceFile;
    /** Top-level const declarations (each becomes a #define). */
    consts: VariableDeclaration[];
    /** Enum declarations (each member becomes a #define named EnumName_Member). */
    enums: EnumDeclaration[];
    /** Top-level let declarations (each becomes an SSL variable). */
    lets: VariableDeclaration[];
    /** Top-level functions, @inline ones included; emission filters those out. */
    functions: FunctionDeclaration[];
}

export interface TsslProgram {
    /** Contributing modules in dependency-first order, the entry last - the order procedures emit in. */
    modules: ModuleItems[];
    entry: ModuleItems;
    /** Enums declared in project code, whose members become EnumName_Member defines. */
    localEnumNames: Set<string>;
    /** `declare enum`s from .d.ts files; their members are bare names the SSL headers define. */
    externEnumNames: Set<string>;
    /** Declarations reachability decided to emit. */
    kept: Set<Node>;
    /** Flat `EnumName_Member` names something referenced, which is what keeps that member's define. */
    usedEnumMembers: Set<string>;
    /** Names of functions declared @inline anywhere in the graph. */
    inlineFunctions: Map<string, InlineFunc>;
    /** The @inline functions something actually calls - only these become macros. */
    usedInline: Set<string>;
    /** Kept procedure names: what gets the `call` keyword, and keeps its parentheses at zero args. */
    definedFunctions: Set<string>;
    /**
     * Per module: local import names whose declaration is called something else (`import { atoi as
     * base_atoi }`, or a renaming re-export). The output only ever contains declaration names, so call
     * sites written against the local name are rendered through this map.
     */
    importRenames: Map<SourceFile, ReadonlyMap<string, string>>;
}

/**
 * The compiler options module resolution needs: folib routes through package.json `exports`.
 *
 * `lib` is pinned to the language core because the default for this target is `lib.es2022.full.d.ts`,
 * which adds DOM, WebWorker and ScriptHost - 1.70 MB of declarations to parse and bind against 0.11 MB
 * without them, for a language whose scripts run inside a game engine. Dropping them takes standing the
 * program up and modelling one script from 854 ms to 547 ms, and its retained heap from 113 MB to 85 MB.
 * It changes nothing a script can express: a name from those libraries was refused before and is refused
 * now, having simply stopped resolving first.
 */
export const TSSL_COMPILER_OPTIONS: ts.CompilerOptions = {
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    lib: ["lib.es2022.d.ts"],
};

/**
 * The entry registers under a shadow `.ts` name because the checker does not resolve imports from a
 * file whose extension it does not know; everything reported to the author uses the real path.
 */
export function shadowEntryPath(entryPath: string): string {
    return `${entryPath}.ts`;
}

/** The file a node's refusal should name - the author's .tssl for nodes in the entry's shadow file. */
export function realFileOf(node: Node): string {
    const file = node.getSourceFile().getFilePath();
    return file.endsWith(".tssl.ts") ? file.slice(0, -".ts".length) : file;
}

/** A refusal pinned to the node that earned it, in the file and line the author can open. */
export function refuseAt(node: Node, message: string): TranspileError {
    return new TranspileError(message, { file: realFileOf(node), line: node.getStartLineNumber() });
}

/** Collects a module's top-level contributions in statement order. */
function collectModuleItems(source: SourceFile, file: string, isEntry: boolean): ModuleItems {
    const items: ModuleItems = { file, isEntry, source, consts: [], enums: [], lets: [], functions: [] };
    for (const stmt of source.getStatements()) {
        switch (stmt.getKind()) {
            case SyntaxKind.VariableStatement: {
                const varStmt = stmt.asKindOrThrow(SyntaxKind.VariableStatement);
                // `declare const` in a .ts file is ambient vocabulary the importing script promises to
                // define (folib's SCRIPT_REALNAME), not a value to emit.
                if (varStmt.hasDeclareKeyword()) break;
                const declList = varStmt.getDeclarationList();
                const keyword = declList.getFirstChild()?.getKind();
                const bucket =
                    keyword === SyntaxKind.ConstKeyword
                        ? items.consts
                        : keyword === SyntaxKind.LetKeyword
                          ? items.lets
                          : null;
                if (bucket) {
                    for (const decl of declList.getDeclarations()) {
                        // A binding pattern's `getName()` is the pattern text, which both back ends would
                        // emit as though it were an identifier. Refused here so neither has to.
                        if (decl.getNameNode().getKind() !== SyntaxKind.Identifier) {
                            throw refuseAt(decl, "destructuring is not supported; declare each variable separately");
                        }
                        bucket.push(decl);
                    }
                }
                break;
            }
            case SyntaxKind.EnumDeclaration: {
                const enumDecl = stmt.asKindOrThrow(SyntaxKind.EnumDeclaration);
                if (!enumDecl.hasDeclareKeyword()) items.enums.push(enumDecl);
                break;
            }
            case SyntaxKind.FunctionDeclaration: {
                const func = stmt.asKindOrThrow(SyntaxKind.FunctionDeclaration);
                // Only the implementation: an overload signature has no body to emit, and an ambient
                // declaration is vocabulary rather than code.
                if (func.getName() && !func.hasDeclareKeyword() && func.getBody() !== undefined) {
                    items.functions.push(func);
                }
                break;
            }
            default:
                // Type-only statements (interfaces, aliases), imports/exports, and top-level expression
                // statements contribute nothing, exactly as they always have.
                break;
        }
    }
    return items;
}

/** Module targets this file pulls in, in statement order - re-export declarations count as imports. */
function moduleEdges(source: SourceFile): SourceFile[] {
    const targets: SourceFile[] = [];
    for (const stmt of source.getStatements()) {
        if (!Node.isImportDeclaration(stmt) && !Node.isExportDeclaration(stmt)) continue;
        if (stmt.isTypeOnly()) continue;
        // `export { x }` re-exports this file's own declarations and names no module.
        const specifier = stmt.getModuleSpecifierValue();
        if (specifier === undefined) continue;
        const target = stmt.getModuleSpecifierSourceFile();
        if (target === undefined) {
            // Refused rather than skipped. A module that does not resolve contributes none of its
            // constants, macros or procedures, and the transpile succeeds anyway - so the hole surfaces
            // as an unrelated complaint from the SSL compiler, or not at all if some other declaration
            // happens to carry the same name.
            throw refuseAt(stmt, `cannot resolve module '${specifier}'`);
        }
        targets.push(target);
    }
    return targets;
}

/**
 * What a module contributed the last time it was walked.
 *
 * The nodes in here belong to one project's AST, so a cache is only ever valid against the project it
 * was filled from, and only while that project's parse of each file still stands. Whoever owns the
 * project owns the invalidation - see `batch.ts`.
 */
export type ModuleWalkCache = Map<string, { edges: SourceFile[]; items: ModuleItems }>;

/**
 * The graph's modules in dependency-first order - the order a bundler concatenates them, which fixes
 * the order procedures are declared in and therefore the compiled procedure table.
 */
function modulesInOrder(entrySource: SourceFile, entryRealPath: string, cache?: ModuleWalkCache): ModuleItems[] {
    const visited = new Set<SourceFile>();
    const ordered: ModuleItems[] = [];
    const visit = (source: SourceFile, isEntry: boolean): void => {
        if (visited.has(source)) return;
        visited.add(source);
        // A .d.ts contributes declarations to the checker, never code to the output; its own imports
        // are type-level and pull nothing in either.
        if (source.getFilePath().endsWith(".d.ts")) return;
        // The entry is never cached: its text is what changed to cause this compile.
        if (isEntry) {
            for (const target of moduleEdges(source)) visit(target, false);
            ordered.push(collectModuleItems(source, entryRealPath, true));
            return;
        }
        const file = source.getFilePath();
        let walked = cache?.get(file);
        if (!walked) {
            walked = { edges: moduleEdges(source), items: collectModuleItems(source, file, false) };
            cache?.set(file, walked);
        }
        for (const target of walked.edges) visit(target, false);
        ordered.push(walked.items);
    };
    visit(entrySource, true);
    return ordered;
}

/**
 * Refuses the import forms the emitter cannot represent, and collects each module's local-name-to-
 * declaration-name renames. A named import is a rename whenever the checker lands on a declaration
 * called something else - an explicit alias, or a `export { x as y }` somewhere along a barrel.
 */
function collectImportRenames(modules: ModuleItems[]): Map<SourceFile, ReadonlyMap<string, string>> {
    const renames = new Map<SourceFile, ReadonlyMap<string, string>>();
    for (const module of modules) {
        const moduleRenames = new Map<string, string>();
        for (const imp of module.source.getImportDeclarations()) {
            if (imp.isTypeOnly()) continue;
            if (imp.getDefaultImport() || imp.getNamespaceImport()) {
                throw refuseAt(imp, "only named imports are supported");
            }
            for (const named of imp.getNamedImports()) {
                if (named.isTypeOnly()) continue;
                const local = named.getAliasNode()?.getText() ?? named.getName();
                const decl = declarationOf(named.getNameNode());
                if (!decl) continue;
                const declName = Node.hasName(decl) ? decl.getName() : undefined;
                if (declName !== undefined && declName !== local) moduleRenames.set(local, declName);
            }
        }
        if (moduleRenames.size > 0) renames.set(module.source, moduleRenames);
    }
    return renames;
}

/** Where the declaration behind a name lives, follow-through re-export barrels included. */
function declarationOf(id: Node): Node | undefined {
    const symbol = id.getSymbol();
    if (!symbol) return undefined;
    const target = symbol.getAliasedSymbol() ?? symbol;
    const declarations = target.getDeclarations();
    // An overloaded function's symbol lists its bodiless signatures first; the implementation is the
    // declaration that can be scanned and emitted, so it stands for the lot.
    const implementation = declarations.find((d) => Node.isFunctionDeclaration(d) && d.getBody() !== undefined);
    return implementation ?? declarations[0];
}

/** Whether a declaration is one of the top-level kinds the emitter can output from a project file. */
function isEmittable(decl: Node): decl is FunctionDeclaration | VariableDeclaration | EnumDeclaration {
    if (decl.getSourceFile().getFilePath().endsWith(".d.ts")) return false;
    if (Node.isFunctionDeclaration(decl)) {
        return decl.getParent()?.getKind() === SyntaxKind.SourceFile && !decl.hasDeclareKeyword();
    }
    if (Node.isEnumDeclaration(decl)) return !decl.hasDeclareKeyword();
    if (Node.isVariableDeclaration(decl)) {
        // Only a top-level, non-ambient declaration: locals resolve here too and are the body's, and a
        // `declare const` is a promise the entry fulfils, not a value.
        if (decl.getVariableStatement()?.hasDeclareKeyword()) return false;
        return decl.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) === undefined;
    }
    return false;
}

/** Function names the engine calls by name, plus everything register_hook_proc registers. */
function rootNames(entrySource: SourceFile, engineProcedureNames: readonly string[]): Set<string> {
    const roots = new Set(engineProcedureNames);
    for (const call of entrySource.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const callee = call.getExpression().getText();
        if (callee !== "register_hook_proc" && callee !== "register_hook_proc_spec") continue;
        const handler = call.getArguments()[1];
        if (handler && Node.isIdentifier(handler)) roots.add(handler.getText());
    }
    return roots;
}

/**
 * Builds the program model for one entry file: the module graph, per-module items, and the reachable
 * subset. `entrySource` must already be registered in the project under `shadowEntryPath(entryPath)`,
 * and the project must have been given `TSSL_COMPILER_OPTIONS`.
 */
export function buildProgramModel(
    project: Project,
    entrySource: SourceFile,
    entryPath: string,
    engineProcedureNames: readonly string[],
    extractInline: (source: SourceFile) => Map<string, InlineFunc>,
    moduleWalkCache?: ModuleWalkCache,
): TsslProgram {
    const modules = modulesInOrder(entrySource, entryPath, moduleWalkCache);
    const importRenames = collectImportRenames(modules);
    const entry = modules[modules.length - 1];
    if (!entry?.isEntry) throw new Error("module order lost the entry");

    const localEnumNames = new Set<string>();
    for (const module of modules) for (const decl of module.enums) localEnumNames.add(decl.getName());
    // Every declare enum the checker can see is extern vocabulary: its members are bare names that the
    // SSL headers #define, so a property access on one prints the member alone.
    const externEnumNames = new Set<string>();
    for (const source of project.getSourceFiles()) {
        if (!source.getFilePath().endsWith(".d.ts")) continue;
        for (const decl of source.getEnums()) externEnumNames.add(decl.getName());
    }

    // Inline-ness is decided by successful EXTRACTION, not the @inline tag alone: a tagged function
    // whose body is none of the shapes the macro extractor reads - control flow, a local - stays a
    // regular procedure rather than refusing the compile.
    const inlineFunctions = new Map<string, InlineFunc>();
    for (const module of modules) {
        for (const [name, fn] of extractInline(module.source)) inlineFunctions.set(name, fn);
    }

    const kept = new Set<Node>();
    const usedEnumMembers = new Set<string>();
    const usedInline = new Set<string>();
    const scanned = new Set<Node>();
    const queue: Node[] = [];

    const keep = (decl: Node): void => {
        if (!kept.has(decl)) {
            kept.add(decl);
            queue.push(decl);
        }
    };
    const scanOnly = (decl: Node): void => {
        if (!scanned.has(decl) && !kept.has(decl)) queue.push(decl);
    };

    /** Marks whatever one identifier reaches. */
    const markIdentifier = (id: Identifier): void => {
        const decl = declarationOf(id);
        if (!decl || !isEmittable(decl)) return;
        const name = Node.isFunctionDeclaration(decl) ? decl.getName() : undefined;
        if (name !== undefined && inlineFunctions.has(name)) {
            usedInline.add(name);
            // The macro's body references travel with it - its constants still need their defines -
            // but the function itself is expanded at call sites, never emitted as a procedure.
            scanOnly(decl);
            return;
        }
        keep(decl);
    };

    const scanBody = (root: Node): void => {
        root.forEachDescendant((node) => {
            if (Node.isPropertyAccessExpression(node)) {
                const obj = node.getExpression();
                if (Node.isIdentifier(obj)) {
                    const decl = declarationOf(obj);
                    if (decl && Node.isEnumDeclaration(decl)) {
                        if (!decl.hasDeclareKeyword()) {
                            usedEnumMembers.add(`${decl.getName()}_${node.getName()}`);
                            if (isEmittable(decl)) keep(decl);
                        }
                        return;
                    }
                }
            }
            if (Node.isIdentifier(node)) markIdentifier(node);
        });
    };

    // Seeds: what the engine reaches by name, what hooks register, and everything the entry's defines
    // state - entry consts are emitted unconditionally, so whatever their values reference is live too.
    const roots = rootNames(entrySource, engineProcedureNames);
    for (const func of entry.functions) {
        const name = func.getName();
        if (name && roots.has(name)) keep(func);
        if (func.isExported()) keep(func);
    }
    for (const decl of entry.consts) keep(decl);
    for (const decl of entry.lets) if (decl.getVariableStatement()?.isExported()) keep(decl);

    while (queue.length > 0) {
        const decl = queue.pop() as Node;
        if (scanned.has(decl)) continue;
        scanned.add(decl);
        if (Node.isFunctionDeclaration(decl)) {
            for (const param of decl.getParameters()) {
                const initializer = param.getInitializer();
                if (initializer) scanBody(initializer);
            }
            const body = decl.getBody();
            if (body) scanBody(body);
        } else if (Node.isVariableDeclaration(decl)) {
            const initializer = decl.getInitializer();
            if (initializer) scanBody(initializer);
        }
        // Enum members carry computed constant values into their defines; nothing further to chase.
    }

    const definedFunctions = new Set<string>();
    for (const module of modules) {
        for (const func of module.functions) {
            const name = func.getName();
            if (name && kept.has(func) && !inlineFunctions.has(name)) definedFunctions.add(name);
        }
    }

    refuseCollisions(modules, kept);

    return {
        modules,
        entry,
        localEnumNames,
        externEnumNames,
        kept,
        usedEnumMembers,
        inlineFunctions,
        usedInline,
        definedFunctions,
        importRenames,
    };
}

/**
 * Two kept declarations sharing one name would emit a program where every reference silently binds to
 * whichever came out last. The bundler used to rename one and the output repair guessed the rename
 * back; refusing with both locations is the honest version.
 */
function refuseCollisions(modules: ModuleItems[], kept: Set<Node>): void {
    const seen = new Map<string, Node>();
    const claim = (name: string, decl: Node): void => {
        const previous = seen.get(name);
        if (previous && previous !== decl) {
            // Two constants stating the same value are one fact twice (fo2tweaks and folib both define
            // PRODATA_SC_TYPE 32); both defines emit and the preprocessor's overwrite is a no-op. Only a
            // name bound to two DIFFERENT things is a program that silently means something else.
            if (
                Node.isVariableDeclaration(previous) &&
                Node.isVariableDeclaration(decl) &&
                previous.getInitializer()?.getText() === decl.getInitializer()?.getText()
            ) {
                return;
            }
            const where = (node: Node) => `${realFileOf(node)}:${node.getStartLineNumber()}`;
            throw refuseAt(
                decl,
                `'${name}' is defined in both ${where(previous)} and ${where(decl)}; rename one of them`,
            );
        }
        seen.set(name, decl);
    };
    for (const module of modules) {
        for (const decl of [...module.consts, ...module.lets]) {
            if (kept.has(decl)) claim(decl.getName(), decl);
        }
        for (const func of module.functions) {
            const name = func.getName();
            if (name && kept.has(func)) claim(name, func);
        }
        for (const decl of module.enums) {
            if (kept.has(decl)) claim(decl.getName(), decl);
        }
    }
}
