/**
 * SSL emission for TSSL transpiler.
 * Renders the program model - the reachable declarations of every module, in module order - as SSL.
 *
 * Output shape: generated header, #includes, the entry's defines, the imported modules' defines plus
 * inline-function macros, forward declarations for every procedure, then the bundled and main code
 * blocks. Each emitted chunk carries the file and line of the declaration it came from, which is what
 * lets a compiler error on the generated SSL be reported on the line the author wrote.
 */

import type { EnumDeclaration, FunctionDeclaration, Node, VariableDeclaration } from "ts-morph";
import { SyntaxKind, conlog, type TsslContext } from "./types";
import { convertOperatorsAST, convertVarOrConstToVariable } from "./convert-operators";
import { generateInlineMacros } from "./inline-functions";
import { refuseAt, type ModuleItems, type TsslProgram } from "./program-model";
import { makeGeneratedHeader } from "../../common/transpiler-utils";
import type { SourcePosition } from "../../common/line-map";
import { TrackedText, joinTracked, type TrackedChunk, type EmittedText } from "../../common/tracked-text";

type Chunk = TrackedChunk<SourcePosition>;

/** One module's contributions, bucketed the way the output interleaves them. */
interface Section {
    defines: Chunk[];
    variables: Chunk[];
    declarations: Chunk[];
    procedures: Chunk[];
}

/**
 * Render the program model as SSL text with per-line source origins.
 * @param program The reachability-resolved program model
 * @param sourceName tssl source name, to put into the generated-file comment
 * @param includes `// #include` magic-comment paths from the entry
 * @param ctx Transpilation context
 * @param traTag Optional @tra filename to preserve in output header
 */
export function exportSSL(
    program: TsslProgram,
    sourceName: string,
    includes: readonly string[],
    ctx: TsslContext,
    traTag?: string,
): EmittedText<SourcePosition> {
    conlog(`Starting conversion of: ${sourceName}`);

    const out = new TrackedText<SourcePosition>();
    out.add(makeGeneratedHeader(sourceName, traTag));

    // Includes first to avoid redefinition warnings
    if (includes.length > 0) {
        for (const inc of includes) {
            out.add(`#include "${inc}"\n`);
        }
        out.add("\n");
    }

    const sections = program.modules.map((module) => renderModule(module, program, ctx));
    const entrySection = sections[sections.length - 1] as Section;
    const bundledSections = sections.slice(0, -1);

    const allDefines: Chunk[] = [];
    const bundledVariables: Chunk[] = [];
    const bundledProcedures: Chunk[] = [];
    const allDeclarations: Chunk[] = [];
    for (const section of bundledSections) {
        allDefines.push(...section.defines);
        allDeclarations.push(...section.declarations);
        bundledVariables.push(...section.variables);
        bundledProcedures.push(...section.procedures);
    }
    allDeclarations.push(...entrySection.declarations);

    // Inline macros go with the imported defines. They are synthesised from a function's whole body
    // rather than emitted from one statement, so they get no line rather than the nearest plausible one.
    const inlineMacros = generateInlineMacros(program.inlineFunctions, program.usedInline, program.localEnumNames);
    allDefines.push(...inlineMacros.map((text) => ({ text })));

    // The entry's own defines come first, as they always have.
    if (entrySection.defines.length > 0) {
        for (const define of entrySection.defines) out.add(`${define.text}\n`, define.origin);
        out.add("\n");
    }

    /** Emit a bucket's chunks one per line, keeping each one's origin. */
    function addBucket(chunks: Chunk[], trailer: string): void {
        if (chunks.length === 0) return;
        out.addAll(joinTracked(chunks, "\n"));
        out.add(trailer);
    }

    addBucket(allDefines, "\n\n");
    addBucket(allDeclarations, "\n");
    if (bundledVariables.length > 0 || bundledProcedures.length > 0) {
        out.add("\n/* ===== bundled ===== */\n");
        addBucket(bundledVariables, "\n");
        addBucket(bundledProcedures, "\n");
        out.add("/* ===== end bundled ===== */\n");
    }
    if (entrySection.variables.length > 0 || entrySection.procedures.length > 0) {
        out.add("\n/* ===== main body ===== */\n");
        addBucket(entrySection.variables, "\n");
        addBucket(entrySection.procedures, "\n");
        out.add("/* ===== end main body ===== */\n");
    }

    // Replace sfall_typeof with typeof (TS keyword conflict workaround). A same-line substitution, so it
    // cannot move a line and the origins collected above still line up.
    return { text: out.text.replaceAll(/\bsfall_typeof\b/g, "typeof"), origins: [...out.origins] };
}

/** Renders one module's kept declarations into buckets, in the module's own statement order. */
function renderModule(module: ModuleItems, program: TsslProgram, ctx: TsslContext): Section {
    const section: Section = { defines: [], variables: [], declarations: [], procedures: [] };
    const originOf = (node: Node): SourcePosition => ({ file: module.file, line: node.getStartLineNumber() - 1 });
    // Identifier renames are per importing module, so the context carries the current module's.
    ctx.importRenames = program.importRenames.get(module.source) ?? new Map();

    for (const stmt of module.source.getStatements()) {
        switch (stmt.getKind()) {
            case SyntaxKind.VariableStatement: {
                const varStmt = stmt.asKindOrThrow(SyntaxKind.VariableStatement);
                const declList = varStmt.getDeclarationList();
                const keyword = declList.getFirstChild()?.getKind();
                for (const decl of declList.getDeclarations()) {
                    if (keyword === SyntaxKind.ConstKeyword) {
                        // The entry's constants are its interface to the headers and emit unconditionally;
                        // an imported module's emit only what something reachable references.
                        if (!module.isEntry && !program.kept.has(decl)) continue;
                        section.defines.push(renderDefine(decl, ctx, originOf(decl)));
                    } else if (keyword === SyntaxKind.LetKeyword) {
                        if (!program.kept.has(decl)) continue;
                        section.variables.push({
                            text: renderVariable(decl, ctx),
                            origin: originOf(decl),
                        });
                    }
                }
                break;
            }
            case SyntaxKind.EnumDeclaration: {
                const enumDecl = stmt.asKindOrThrow(SyntaxKind.EnumDeclaration);
                if (enumDecl.hasDeclareKeyword()) break;
                section.defines.push(...renderEnum(enumDecl, program, originOf(enumDecl)));
                break;
            }
            case SyntaxKind.FunctionDeclaration: {
                const func = stmt.asKindOrThrow(SyntaxKind.FunctionDeclaration);
                const name = func.getName();
                if (!name || !program.kept.has(func)) break;
                // Extracted inline functions expand at call sites; list() and map() become literals.
                if (program.inlineFunctions.has(name) || name === "list" || name === "map") break;
                renderProcedure(func, name, module, ctx, section, originOf(func));
                break;
            }
            default:
                break;
        }
    }
    return section;
}

/** `#define name value`, the value converted to SSL spelling. */
function renderDefine(decl: VariableDeclaration, ctx: TsslContext, origin: SourcePosition): Chunk {
    const initializer = decl.getInitializer();
    const value = initializer ? convertOperatorsAST(initializer, ctx) : "";
    return { text: `#define ${decl.getName()} ${value}`, origin };
}

/** `variable name = value;` - rebuilt from the declaration, so type annotations erase. */
function renderVariable(decl: VariableDeclaration, ctx: TsslContext): string {
    const initializer = decl.getInitializer();
    return initializer
        ? `variable ${decl.getName()} = ${convertOperatorsAST(initializer, ctx)};`
        : `variable ${decl.getName()};`;
}

/** One `#define Enum_Member value` per member something referenced; the rest tree-shake away. */
function renderEnum(enumDecl: EnumDeclaration, program: TsslProgram, origin: SourcePosition): Chunk[] {
    const chunks: Chunk[] = [];
    for (const member of enumDecl.getMembers()) {
        const flat = `${enumDecl.getName()}_${member.getName()}`;
        if (!program.usedEnumMembers.has(flat)) continue;
        const value = member.getValue();
        const rendered = value === undefined ? "0" : typeof value === "string" ? JSON.stringify(value) : String(value);
        chunks.push({ text: `#define ${flat} ${rendered}`, origin });
    }
    return chunks;
}

/** A procedure's forward declaration and body, the entry's with its JSDoc restored above it. */
function renderProcedure(
    func: FunctionDeclaration,
    name: string,
    module: ModuleItems,
    ctx: TsslContext,
    section: Section,
    origin: SourcePosition,
): void {
    const paramsWithDefaults = func
        .getParameters()
        .map((p) => {
            const init = p.getInitializer();
            if (init) {
                return `variable ${p.getName()} = ${convertOperatorsAST(init, ctx)}`;
            }
            return `variable ${p.getName()}`;
        })
        .join(", ");
    const params = func
        .getParameters()
        .map((p) => `variable ${p.getName()}`)
        .join(", ");
    const bodyNode = func.getBody();
    const body = bodyNode ? processFunctionBody(bodyNode, "    ", ctx) : "";

    section.declarations.push({ text: `procedure ${name}(${paramsWithDefaults});`, origin });

    const jsDoc = module.isEntry ? ctx.functionJsDocs.get(name) : undefined;
    const procCode = `procedure ${name}(${params}) begin\n${body ? body + "\n" : ""}end`;
    section.procedures.push({ text: jsDoc ? `${jsDoc}\n${procCode}` : procCode, origin });
}

// ============================================================================
// Statement Handlers - each handles one TypeScript statement type
// ============================================================================

function handleIfStatement(stmt: Node, indent: string, ctx: TsslContext): string {
    const ifStmt = stmt.asKindOrThrow(SyntaxKind.IfStatement);
    const cond = convertOperatorsAST(ifStmt.getExpression(), ctx);
    const thenStmt = ifStmt.getThenStatement();
    let result = `${indent}if (${cond}) then begin\n`;
    result += processFunctionBody(thenStmt, indent + "    ", ctx);
    result += `\n${indent}end`;
    const elseStmt = ifStmt.getElseStatement();
    if (elseStmt) {
        result += ` else begin\n`;
        result += processFunctionBody(elseStmt, indent + "    ", ctx);
        result += `\n${indent}end`;
    }
    return result + `\n`;
}

function handleVariableStatement(stmt: Node, indent: string, ctx: TsslContext): string {
    const varStmt = stmt.asKind(SyntaxKind.VariableStatement);
    if (varStmt) {
        const keyword = varStmt.getDeclarationList().getFirstChild()?.getKind();
        if (keyword === SyntaxKind.LetKeyword || keyword === SyntaxKind.ConstKeyword) {
            return `${indent}${convertVarOrConstToVariable(stmt, ctx)}\n`;
        }
    }
    throw refuseAt(stmt, "only 'let' and 'const' declarations are supported");
}

function handleExpressionStatement(stmt: Node, indent: string, ctx: TsslContext): string {
    const exprStmt = stmt.asKindOrThrow(SyntaxKind.ExpressionStatement);
    const expr = exprStmt.getExpression();
    if (expr.getKind() === SyntaxKind.CallExpression) {
        return `${indent}${processCallExpression(expr, ctx)};\n`;
    }
    const converted = convertOperatorsAST(expr, ctx);
    return `${indent}${converted};\n`;
}

function handleReturnStatement(stmt: Node, indent: string, ctx: TsslContext): string {
    const ret = stmt.asKindOrThrow(SyntaxKind.ReturnStatement);
    const expr = ret.getExpression();
    return `${indent}return${expr ? " " + convertOperatorsAST(expr, ctx) : ""};\n`;
}

function handleForStatement(stmt: Node, indent: string, ctx: TsslContext): string {
    const forStmt = stmt.asKindOrThrow(SyntaxKind.ForStatement);
    const init = forStmt.getInitializer();
    const cond = forStmt.getCondition();
    const incr = forStmt.getIncrementor();
    const body = forStmt.getStatement();

    let initStr = "";
    if (init) {
        if (init.getKind() === SyntaxKind.VariableDeclarationList) {
            const declList = init.asKindOrThrow(SyntaxKind.VariableDeclarationList);
            const decl = declList.getDeclarations()[0];
            if (decl) {
                const name = decl.getName();
                const initializer = decl.getInitializer();
                initStr = `variable ${name} = ${initializer ? convertOperatorsAST(initializer, ctx) : "0"}`;
            }
        } else {
            initStr = convertOperatorsAST(init, ctx);
        }
    }

    const condStr = cond ? convertOperatorsAST(cond, ctx) : "true";
    const incrStr = incr ? convertOperatorsAST(incr, ctx) : "";

    let result = `${indent}for (${initStr}; ${condStr}; ${incrStr}) begin\n`;
    result += processFunctionBody(body, indent + "    ", ctx);
    return result + `\n${indent}end\n`;
}

function handleWhileStatement(stmt: Node, indent: string, ctx: TsslContext): string {
    const whileStmt = stmt.asKindOrThrow(SyntaxKind.WhileStatement);
    const cond = convertOperatorsAST(whileStmt.getExpression(), ctx);
    const body = whileStmt.getStatement();

    let result = `${indent}while (${cond}) do begin\n`;
    result += processFunctionBody(body, indent + "    ", ctx);
    return result + `\n${indent}end\n`;
}

function handleForEachStatement(stmt: Node, indent: string, ctx: TsslContext): string {
    const forStmt =
        stmt.getKind() === SyntaxKind.ForInStatement
            ? stmt.asKindOrThrow(SyntaxKind.ForInStatement)
            : stmt.asKindOrThrow(SyntaxKind.ForOfStatement);
    const init = forStmt.getInitializer();
    const expr = forStmt.getExpression();
    const body = forStmt.getStatement();

    let varPart = "";
    if (init.getKind() === SyntaxKind.VariableDeclarationList) {
        const declList = init.asKindOrThrow(SyntaxKind.VariableDeclarationList);
        const decl = declList.getDeclarations()[0];
        if (decl) {
            const nameNode = decl.getNameNode();
            // Check for array destructuring: const [k, v] -> variable k: v
            if (nameNode.getKind() === SyntaxKind.ArrayBindingPattern) {
                const binding = nameNode.asKindOrThrow(SyntaxKind.ArrayBindingPattern);
                const elements = binding.getElements();
                const el0 = elements[0];
                const el1 = elements[1];
                if (elements.length === 2 && el0 && el1) {
                    const key = el0.asKind(SyntaxKind.BindingElement)?.getName() ?? el0.getText();
                    const val = el1.asKind(SyntaxKind.BindingElement)?.getName() ?? el1.getText();
                    varPart = `variable ${key}: ${val}`;
                } else {
                    throw refuseAt(stmt, `foreach destructuring must have exactly 2 elements, got ${elements.length}`);
                }
            } else {
                varPart = `variable ${decl.getName()}`;
            }
        }
    } else {
        varPart = init.getText();
    }

    let result = `${indent}foreach (${varPart} in ${convertOperatorsAST(expr, ctx)}) begin\n`;
    result += processFunctionBody(body, indent + "    ", ctx);
    return result + `\n${indent}end\n`;
}

function handleSwitchStatement(stmt: Node, indent: string, ctx: TsslContext): string {
    const switchStmt = stmt.asKindOrThrow(SyntaxKind.SwitchStatement);
    const expr = switchStmt.getExpression();
    const clauses = switchStmt.getCaseBlock().getClauses();
    const caseIndent = indent + "    ";
    const bodyIndent = indent + "        ";

    let result = `${indent}switch (${convertOperatorsAST(expr, ctx)}) begin\n`;
    for (const clause of clauses) {
        if (clause.getKind() === SyntaxKind.CaseClause) {
            const caseClause = clause.asKindOrThrow(SyntaxKind.CaseClause);
            const caseExpr = caseClause.getExpression();
            const statements = caseClause.getStatements();
            const filteredStmts = statements.filter((s) => s.getKind() !== SyntaxKind.BreakStatement);
            result += `${caseIndent}case ${convertOperatorsAST(caseExpr, ctx)}:\n`;
            for (const s of filteredStmts) {
                result += processFunctionBody(s, bodyIndent, ctx) + "\n";
            }
        } else if (clause.getKind() === SyntaxKind.DefaultClause) {
            const defaultClause = clause.asKindOrThrow(SyntaxKind.DefaultClause);
            const statements = defaultClause.getStatements();
            const filteredStmts = statements.filter((s) => s.getKind() !== SyntaxKind.BreakStatement);
            result += `${caseIndent}default:\n`;
            for (const s of filteredStmts) {
                result += processFunctionBody(s, bodyIndent, ctx) + "\n";
            }
        }
    }
    return result + `${indent}end\n`;
}

function handleDoStatement(stmt: Node, indent: string, ctx: TsslContext): string {
    const doStmt = stmt.asKindOrThrow(SyntaxKind.DoStatement);
    const cond = convertOperatorsAST(doStmt.getExpression(), ctx);
    const body = doStmt.getStatement();

    const varName = `__tssl_do_${ctx.doStatementCounter++}`;
    let result = `${indent}variable ${varName} = 1;\n`;
    result += `${indent}while (${varName} or (${cond})) do begin\n`;
    result += `${indent}    ${varName} = 0;\n`;
    result += processFunctionBody(body, indent + "    ", ctx);
    return result + `\n${indent}end\n`;
}

// ============================================================================
// Main function body processor
// ============================================================================

/**
 * Traverse the function body AST and convert statements to SSL syntax.
 */
export function processFunctionBody(bodyNode: Node, indent: string = "", ctx: TsslContext): string {
    let stmts: Node[] = [];
    if (bodyNode.getKind() === SyntaxKind.Block) {
        stmts = bodyNode.asKindOrThrow(SyntaxKind.Block).getStatements();
    } else if (bodyNode.getKind() === SyntaxKind.CaseClause) {
        stmts = bodyNode.asKindOrThrow(SyntaxKind.CaseClause).getStatements();
    } else if (bodyNode.getKind() === SyntaxKind.DefaultClause) {
        stmts = bodyNode.asKindOrThrow(SyntaxKind.DefaultClause).getStatements();
    } else {
        stmts = [bodyNode];
    }

    let result = "";
    stmts.forEach((stmt, i) => {
        const prevStmt = i > 0 ? stmts[i - 1] : null;

        // Add blank line between statements if they were on different source lines
        if (prevStmt && result.length > 0) {
            const prevLine = prevStmt.getEndLineNumber();
            const currLine = stmt.getStartLineNumber();
            if (currLine - prevLine > 1) {
                result += "\n";
            }
        }

        switch (stmt.getKind()) {
            case SyntaxKind.IfStatement:
                result += handleIfStatement(stmt, indent, ctx);
                break;
            case SyntaxKind.VariableStatement:
                result += handleVariableStatement(stmt, indent, ctx);
                break;
            case SyntaxKind.ExpressionStatement:
                result += handleExpressionStatement(stmt, indent, ctx);
                break;
            case SyntaxKind.ReturnStatement:
                result += handleReturnStatement(stmt, indent, ctx);
                break;
            case SyntaxKind.ForStatement:
                result += handleForStatement(stmt, indent, ctx);
                break;
            case SyntaxKind.WhileStatement:
                result += handleWhileStatement(stmt, indent, ctx);
                break;
            case SyntaxKind.ForInStatement:
            case SyntaxKind.ForOfStatement:
                result += handleForEachStatement(stmt, indent, ctx);
                break;
            case SyntaxKind.SwitchStatement:
                result += handleSwitchStatement(stmt, indent, ctx);
                break;
            case SyntaxKind.DoStatement:
                result += handleDoStatement(stmt, indent, ctx);
                break;
            case SyntaxKind.TryStatement:
                throw refuseAt(stmt, "try/catch is not supported in SSL");
            case SyntaxKind.ContinueStatement:
                result += `${indent}continue;\n`;
                break;
            case SyntaxKind.BreakStatement:
                result += `${indent}break;\n`;
                break;
            case SyntaxKind.EmptyStatement:
                // bare `;` - no output needed
                break;
            default:
                throw refuseAt(
                    stmt,
                    `Unhandled statement type: ${stmt.getKindName()}. Code: ${stmt.getText().substring(0, 100)}`,
                );
        }
    });
    return result.trimEnd();
}

/**
 * Process a call expression and add 'call' keyword if needed
 * @param callExpr The call expression node
 * @param ctx Transpilation context
 * @returns The processed call expression as a string
 */
function processCallExpression(callExpr: Node, ctx: TsslContext): string {
    const callExpression = callExpr.asKindOrThrow(SyntaxKind.CallExpression);
    // Converted rather than raw, so an imported alias is judged (and printed) as the name it declares.
    const fnName = convertOperatorsAST(callExpression.getExpression(), ctx);

    // The only call rule unique to statement context is SSL's `call` keyword for a
    // standalone call to a defined procedure (not an inline macro).
    const parent = callExpr.getParent();
    const isStandaloneCall = parent !== undefined && parent.getKind() === SyntaxKind.ExpressionStatement;
    if (isStandaloneCall && ctx.definedFunctions.has(fnName) && !ctx.inlineFunctions.has(fnName)) {
        const processedArgs = callExpression.getArguments().map((arg: Node) => convertOperatorsAST(arg, ctx));
        return `call ${fnName}(${processedArgs.join(", ")})`;
    }

    // Everything else - list()/map() literals, zero-arg paren elision, and the
    // default `fn(args)` form - is the shared call transform in convert-operators.
    return convertOperatorsAST(callExpr, ctx);
}
