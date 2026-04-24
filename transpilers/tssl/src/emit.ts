/**
 * SSL emission for TSSL transpiler.
 * Converts TypeScript AST to Fallout SSL output, handling all statement types.
 */

import { SourceFile, Node } from "ts-morph";
import {
    SyntaxKind,
    conlog,
    SOURCE_COMMENT_LOOKBACK,
    type TsslContext,
    type MainFileData,
    type SourceSection,
} from "./types";
import { convertOperatorsAST, convertVarOrConstToVariable } from "./convert-operators";
import { findUsedInlineFunctions, generateInlineMacros } from "./inline-functions";

/**
 * Export typescript code as SSL string.
 * @param sourceFile ts-morph source file
 * @param sourceName tssl source name, to put into comment
 * @param mainFileData Data extracted from main file (constants, letVars, includes)
 * @param ctx Transpilation context
 * @param traTag Optional @tra filename to preserve in output header
 * @returns Generated SSL output string
 */
export function exportSSL(
    sourceFile: SourceFile,
    sourceName: string,
    mainFileData: MainFileData,
    ctx: TsslContext,
    traTag?: string,
): string {
    conlog(`Starting conversion of: ${sourceName}`);

    const traLine = traTag ? `/** @tra ${traTag} */\n` : "";
    const header = `${traLine}/* Do not edit. This file is generated from ${sourceName}. Make your changes there and regenerate this file. */\n\n`;
    const { sections } = processInput(sourceFile, mainFileData, ctx);
    let output = header;

    // Includes first to avoid redefinition warnings
    if (mainFileData.includes.length > 0) {
        for (const inc of mainFileData.includes) {
            output += `#include "${inc}"\n`;
        }
        output += "\n";
    }

    // Separate bundled vs main sections
    // Main file has sourceName (e.g., "foo.tssl" -> "foo.ts" in esbuild source comments)
    const mainFileMarker = sourceName.replace(".tssl", ".ts");
    const mainSections = sections.filter((s) => s.source.includes(mainFileMarker));
    const bundledSections = sections.filter((s) => !s.source.includes(mainFileMarker));

    // Collect all defines, declarations, variables, procedures
    const allDefines: string[] = [];
    const allDeclarations: string[] = [];
    const bundledVariables: string[] = [];
    const bundledProcedures: string[] = [];
    const mainVariables: string[] = [];
    const mainProcedures: string[] = [];

    for (const s of bundledSections) {
        allDefines.push(...s.defines);
        allDeclarations.push(...s.declarations);
        bundledVariables.push(...s.variables);
        bundledProcedures.push(...s.procedures);
    }
    for (const s of mainSections) {
        allDefines.push(...s.defines);
        allDeclarations.push(...s.declarations);
        mainVariables.push(...s.variables);
        mainProcedures.push(...s.procedures);
    }

    // Add inline function macros to defines (only for functions actually used)
    const usedInlineFuncs = findUsedInlineFunctions(sourceFile, ctx.inlineFunctions);
    const inlineMacros = generateInlineMacros(ctx.inlineFunctions, usedInlineFuncs, ctx.enumNames);
    allDefines.push(...inlineMacros);

    // Output main file constants, tree-shaking unused enum members.
    // Enum-generated constants (EnumName_Member) are only emitted if referenced
    // in the bundled code or inline macros. Non-enum constants pass through unconditionally.
    if (mainFileData.constants.size > 0) {
        const referencedIds = collectReferencedIdentifiers(sourceFile, allDefines);
        for (const [name, value] of mainFileData.constants) {
            if (isEnumConstant(name, ctx.enumNames) && !referencedIds.has(name)) {
                continue;
            }
            output += `#define ${name} ${value}\n`;
        }
        output += "\n";
    }

    // Output in order: defines, declarations, bundled code, main code
    if (allDefines.length > 0) output += allDefines.join("\n") + "\n\n";
    if (allDeclarations.length > 0) output += allDeclarations.join("\n") + "\n";
    if (bundledVariables.length > 0 || bundledProcedures.length > 0) {
        output += "\n/* ===== bundled ===== */\n";
        if (bundledVariables.length > 0) output += bundledVariables.join("\n") + "\n";
        if (bundledProcedures.length > 0) output += bundledProcedures.join("\n") + "\n";
        output += "/* ===== end bundled ===== */\n";
    }
    if (mainVariables.length > 0 || mainProcedures.length > 0) {
        output += "\n/* ===== main body ===== */\n";
        if (mainVariables.length > 0) output += mainVariables.join("\n") + "\n";
        if (mainProcedures.length > 0) output += mainProcedures.join("\n") + "\n";
        output += "/* ===== end main body ===== */\n";
    }

    // Replace sfall_typeof with typeof (TS keyword conflict workaround)
    output = output.replace(/\bsfall_typeof\b/g, "typeof");

    return output;
}

/**
 * iterate over top level statements and print them
 * @param source ts-morph source file
 * @param mainFileData Data extracted from main file (constants, letVars, includes)
 * @param ctx Transpilation context
 * @returns sections grouped by source file
 */
function processInput(source: SourceFile, mainFileData: MainFileData, ctx: TsslContext): { sections: SourceSection[] } {
    const sections: SourceSection[] = [];
    let currentSection: SourceSection | null = null;

    // Build a set of defined function names
    ctx.definedFunctions.clear();
    for (const stmt of source.getStatements()) {
        if (stmt.getKind() === SyntaxKind.FunctionDeclaration) {
            const func = stmt.asKind(SyntaxKind.FunctionDeclaration);
            const name = func?.getName();
            if (name) {
                ctx.definedFunctions.add(name);
            }
        }
    }

    function getOrCreateSection(sourcePath: string): SourceSection {
        if (!currentSection || currentSection.source !== sourcePath) {
            currentSection = { source: sourcePath, defines: [], variables: [], declarations: [], procedures: [] };
            sections.push(currentSection);
        }
        return currentSection;
    }

    // Track current source from esbuild comments
    let currentSource = "unknown";
    const sourceText = source.getFullText();
    const lines = sourceText.split("\n");

    function updateSourceFromLine(stmtStart: number): void {
        const stmtLine = source.getLineAndColumnAtPos(stmtStart).line;
        // Look backwards from statement to find source comment (stmtLine is 1-based, lines is 0-based)
        // lines[stmtLine - 2] is the line immediately before the statement
        for (let i = stmtLine - 2; i >= 0 && i >= stmtLine - SOURCE_COMMENT_LOOKBACK; i--) {
            const line = lines[i]?.trim();
            if (line?.startsWith("// ") && (line.includes("/") || line.includes(".ts"))) {
                currentSource = line.substring(3);
                break;
            }
        }
    }

    for (const stmt of source.getStatements()) {
        updateSourceFromLine(stmt.getStart());
        const section = getOrCreateSection(currentSource);

        if (stmt.getKind() === SyntaxKind.VariableStatement) {
            const varStmt = stmt.asKind(SyntaxKind.VariableStatement);
            if (!varStmt) continue;
            const declList = varStmt.getDeclarationList();
            const keywordKind = declList.getFirstChild()?.getKind();

            for (const decl of declList.getDeclarations()) {
                const name = decl.getName();
                const init = decl.getInitializer();
                const initText = init ? convertOperatorsAST(init, ctx) : "";

                // const -> #define
                // var (was const after esbuild) -> #define, unless it's a main file let
                // let -> variable
                // Skip entirely if this was a main file const (already output as #define)
                const isMainFileLetVar = mainFileData.letVars.has(name);
                const isMainFileConst = mainFileData.constants.has(name);
                if (isMainFileConst) {
                    // Skip - already output as #define from mainFileConstants
                } else if (
                    keywordKind === SyntaxKind.ConstKeyword ||
                    (keywordKind === SyntaxKind.VarKeyword && !isMainFileLetVar)
                ) {
                    section.defines.push(`#define ${name} ${initText}`);
                } else if (keywordKind === SyntaxKind.LetKeyword || keywordKind === SyntaxKind.VarKeyword) {
                    section.variables.push(`variable ${name}${initText ? ` = ${initText}` : ""};`);
                }
            }
        } else if (stmt.getKind() === SyntaxKind.FunctionDeclaration) {
            const func = stmt.asKind(SyntaxKind.FunctionDeclaration);
            if (!func) continue;
            const name = func.getName();

            // Skip inline functions - they are expanded at call sites, not emitted as procedures
            if (name && ctx.inlineFunctions.has(name)) continue;

            // Skip list() and map() - they are converted to array/map literal by the transpiler
            if (name === "list" || name === "map") continue;

            const paramsWithDefaults = func
                .getParameters()
                .map((p) => {
                    const paramName = p.getName();
                    const init = p.getInitializer();
                    if (init) {
                        return `variable ${paramName} = ${convertOperatorsAST(init, ctx)}`;
                    }
                    return `variable ${paramName}`;
                })
                .join(", ");
            const params = func
                .getParameters()
                .map((p) => `variable ${p.getName()}`)
                .join(", ");
            const body = func.getBody() ? processFunctionBody(func.getBody()!, "    ", ctx) : "";

            section.declarations.push(`procedure ${name}(${paramsWithDefaults});`);

            // Include JSDoc as SSL comment if available
            const jsDoc = name ? ctx.functionJsDocs.get(name) : undefined;
            const procCode = `procedure ${name}(${params}) begin\n${body ? body + "\n" : ""}end`;
            section.procedures.push(jsDoc ? `${jsDoc}\n${procCode}` : procCode);
        }
    }
    return { sections };
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
        const declList = varStmt.getDeclarationList();
        const keywordNode = declList.getFirstChild();
        const keywordKind = keywordNode ? keywordNode.getKind() : undefined;
        if (keywordKind === SyntaxKind.LetKeyword || keywordKind === SyntaxKind.ConstKeyword) {
            const converted = convertVarOrConstToVariable(stmt, ctx).trim();
            return `${indent}${converted}\n`;
        }
    }
    return `${indent}${stmt.getText().trim()}\n`;
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
                    throw new Error(`foreach destructuring must have exactly 2 elements, got ${elements.length}`);
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
function processFunctionBody(bodyNode: Node, indent: string = "", ctx: TsslContext): string {
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
                throw new Error("try/catch is not supported in SSL");
            case SyntaxKind.ContinueStatement:
                result += `${indent}continue;\n`;
                break;
            case SyntaxKind.BreakStatement:
                result += `${indent}break;\n`;
                break;
            case SyntaxKind.EmptyStatement:
                // bare `;` — no output needed
                break;
            default:
                throw new Error(
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
    // We need to cast to the appropriate type
    const callExpression = callExpr.asKindOrThrow(SyntaxKind.CallExpression);

    // Get the expression being called (usually an identifier)
    const expression = callExpression.getExpression();

    // Get the arguments
    const args = callExpression.getArguments();

    // Get function name
    const fnName = expression.getText();

    // Special handling for list() and map() - convert to SSL array/map literals
    if (fnName === "list") {
        const processedArgs = args.map((arg: Node) => convertOperatorsAST(arg, ctx));
        return `[${processedArgs.join(", ")}]`;
    }
    if (fnName === "map") {
        if (args.length === 0) {
            return "{}";
        }
        // map() takes a single object argument, just output it directly
        const arg0 = args[0];
        if (args.length === 1 && arg0) {
            return convertOperatorsAST(arg0, ctx);
        }
    }

    // Convert arguments with operator conversion
    const processedArgs = args.map((arg: Node) => convertOperatorsAST(arg, ctx));

    // Check if this is a standalone call expression (not part of an assignment or return)
    const parent = callExpr.getParent();
    const isStandaloneCall = parent && parent.getKind() === SyntaxKind.ExpressionStatement;

    // Only add 'call' keyword if it's a standalone call AND the function is defined in our file (not inline)
    if (isStandaloneCall && ctx.definedFunctions.has(fnName) && !ctx.inlineFunctions.has(fnName)) {
        return `call ${fnName}(${processedArgs.join(", ")})`;
    }

    // For zero-arg inline macros, don't include parentheses
    const inlineFunc = ctx.inlineFunctions.get(fnName);
    if (args.length === 0 && inlineFunc?.params.length === 0) {
        return fnName;
    }

    // For zero-arg external function calls (not defined in this file), don't include parentheses
    // SSL doesn't use parens for zero-arg calls like get_light_level, game_loaded, etc.
    if (args.length === 0 && !ctx.definedFunctions.has(fnName)) {
        return fnName;
    }

    // Otherwise keep as is (either it's an external function or part of an assignment)
    return `${fnName}(${processedArgs.join(", ")})`;
}

/**
 * Collect all identifier names referenced in the bundled source file and inline macros.
 * Used to tree-shake unused enum-generated constants.
 */
export function collectReferencedIdentifiers(sourceFile: SourceFile, defines: readonly string[]): ReadonlySet<string> {
    const ids = new Set<string>();

    // Identifiers from the bundled TypeScript AST
    for (const id of sourceFile.getDescendantsOfKind(SyntaxKind.Identifier)) {
        ids.add(id.getText());
    }

    // Identifiers from inline macro strings (e.g. "#define fn get_stat(dude_obj, STAT_ch)")
    for (const def of defines) {
        for (const match of def.matchAll(/\b\w+\b/g)) {
            ids.add(match[0]);
        }
    }

    return ids;
}

/**
 * Check if a constant name was generated from an enum declaration.
 * Enum constants follow the pattern EnumName_Member where EnumName is a known enum.
 */
export function isEnumConstant(name: string, enumNames: ReadonlySet<string>): boolean {
    // Check all underscore positions to handle enum names with underscores
    // (e.g. DAMAGE_TYPE_Fire should match enum name DAMAGE_TYPE)
    let idx = 0;
    while ((idx = name.indexOf("_", idx)) !== -1) {
        if (enumNames.has(name.substring(0, idx))) {
            return true;
        }
        idx++;
    }
    return false;
}
