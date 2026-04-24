/**
 * TD chain processing - transforms TypeScript chain/interject function bodies
 * into TDChain entries and epilogues.
 *
 * Handles two syntax forms for chains:
 * - Old form: say(speaker, text) / say(text) for multisay
 * - New form: from(speaker) / fromWhen(speaker, cond) / say(text)
 */

import {
    CallExpression,
    Expression,
    FunctionDeclaration,
    FunctionExpression,
    IfStatement,
    Node,
    Statement,
    SyntaxKind,
} from "ts-morph";
import { TDEpilogueType, TDConstructType, type TDChain, type TDChainEntry, type TDChainEpilogue } from "./types";
import * as utils from "../../common/transpiler-utils";
import type { VarsContext } from "../../common/transpiler-utils";
import { resolveStringExpr, expressionToActionString, validateArgs } from "./parse-helpers";
import { TranspileError } from "../../common/transpile-error";
import { expressionToTrigger, expressionToText } from "./expression-eval";

/** TD say keyword constant */
const SAY_KEYWORD = "say";

/**
 * Transform a function to a CHAIN.
 */
function transformFunctionToChain(
    func: FunctionDeclaration | FunctionExpression,
    vars: VarsContext,
    entryTrigger?: string,
): TDChain | null {
    const name = func.getName();
    if (!name) return null;

    const body = func.getBody()?.asKind(SyntaxKind.Block);
    if (!body) return null;

    // Get first speaker from first say(speaker, text)
    let filename = "";
    const entries: TDChainEntry[] = [];
    let currentEntry: TDChainEntry | null = null;
    let epilogue: TDChainEpilogue = { type: TDEpilogueType.Exit };

    for (const stmt of body.getStatements()) {
        if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
            const expr = stmt.getExpression();
            if (Node.isCallExpression(expr)) {
                const funcName = expr.getExpression().getText();
                const args = expr.getArguments();

                if (funcName === SAY_KEYWORD) {
                    currentEntry = processSayInChain(args, expr, currentEntry, entries, vars);
                    // Extract filename from first speaker
                    if (!filename && currentEntry?.speaker) {
                        filename = currentEntry.speaker;
                    }
                } else if (funcName === "action") {
                    // Action after current entry
                    if (args.length === 0) {
                        throw TranspileError.fromNode(expr, `action() requires at least 1 argument`);
                    }
                    if (!currentEntry) {
                        throw TranspileError.fromNode(expr, `action() must come after a say() statement`);
                    }
                    currentEntry.action = args.map((a) => a.getText()).join(" ");
                } else if (funcName === "exit") {
                    epilogue = { type: TDEpilogueType.Exit };
                } else if (funcName === "goTo") {
                    if (args.length < 1 || !args[0]) {
                        throw TranspileError.fromNode(expr, `goTo() requires at least 1 argument`);
                    }
                    epilogue = {
                        type: TDEpilogueType.End,
                        filename,
                        target: args[0].getText(),
                    };
                }
            }
        } else if (stmt.isKind(SyntaxKind.IfStatement)) {
            // Conditional in chain - push current entry first to preserve order
            if (currentEntry) {
                entries.push(currentEntry);
                currentEntry = null;
            }
            processChainIf(stmt as IfStatement, entries, vars);
        }
    }

    // Push final entry
    if (currentEntry) {
        entries.push(currentEntry);
    }

    return {
        type: TDConstructType.Chain,
        filename,
        label: name,
        trigger: entryTrigger,
        entries,
        epilogue,
    };
}

/**
 * Process say() call within chain context.
 * Handles say(speaker, text) vs say(text) multisay pattern.
 */
function processSayInChain(
    args: Node[],
    expr: CallExpression,
    currentEntry: TDChainEntry | null,
    entries: TDChainEntry[],
    vars: VarsContext,
    options?: { trigger?: string },
): TDChainEntry | null {
    if (args.length >= 2 && args[0] && args[1]) {
        // say(speaker, text) - new entry with speaker
        if (currentEntry) {
            entries.push(currentEntry);
        }
        const newEntry: TDChainEntry = {
            speaker: utils.stripQuotes(args[0].getText()),
            texts: [expressionToText(args[1] as Expression, vars)],
        };
        if (options?.trigger) {
            newEntry.trigger = options.trigger;
        }
        return newEntry;
    } else if (args.length >= 1 && args[0]) {
        // say(text) - multisay continuation
        if (!currentEntry) {
            throw TranspileError.fromNode(expr, `say(text) without speaker - must use say(speaker, text) first`);
        }
        currentEntry.texts.push(expressionToText(args[0] as Expression, vars));
        return currentEntry;
    } else {
        throw TranspileError.fromNode(expr, `say() requires at least 1 argument`);
    }
}

/**
 * Process chain function body statements to extract entries.
 * Handles say(speaker, text), say(text) multisay, and conditionals.
 */
function processChainStatements(
    statements: Statement[],
    entries: TDChainEntry[],
    currentEntry: TDChainEntry | null,
    vars: VarsContext,
    options?: { trigger?: string },
): TDChainEntry | null {
    for (const stmt of statements) {
        if (stmt.isKind(SyntaxKind.ExpressionStatement)) {
            const expr = stmt.getExpression();
            if (Node.isCallExpression(expr)) {
                const funcName = expr.getExpression().getText();
                const args = expr.getArguments();

                if (funcName === SAY_KEYWORD) {
                    currentEntry = processSayInChain(args, expr, currentEntry, entries, vars, options);
                }
            }
        } else if (stmt.isKind(SyntaxKind.IfStatement)) {
            // Push current entry before processing conditional
            if (currentEntry) {
                entries.push(currentEntry);
                currentEntry = null;
            }
            processChainIf(stmt as IfStatement, entries, vars);
        }
    }

    return currentEntry;
}

/**
 * Process an if statement inside a chain (conditional text).
 */
function processChainIf(ifStmt: IfStatement, entries: TDChainEntry[], vars: VarsContext) {
    const trigger = expressionToTrigger(ifStmt.getExpression(), vars);
    const thenStmts = utils.getBlockStatements(ifStmt.getThenStatement());

    const conditionalEntry = processChainStatements(thenStmts, entries, null, vars, { trigger });

    // Push final conditional entry
    if (conditionalEntry) {
        entries.push(conditionalEntry);
    }
}

// =========================================================================
// New Chain Body Processing (from/fromWhen form)
// =========================================================================

/** Result of processing a chain body with from()/fromWhen() syntax. */
interface ChainBodyResult {
    entries: TDChainEntry[];
    epilogue: TDChainEpilogue;
}

/**
 * Process chain body using the new from()/fromWhen()/say() syntax.
 * Also supports the old say(speaker, text) syntax within the same body.
 *
 * New syntax:
 *   from("SPEAKER")            - switch to speaker
 *   fromWhen("SPEAKER", cond)  - switch to speaker with condition
 *   say(text)                  - add text to current speaker
 *   action(...)                - add action after current entry
 *   exit()                     - set epilogue to EXIT
 *   goTo(target)               - set epilogue to END
 */
function processChainBody(statements: Statement[], defaultFilename: string, vars: VarsContext): ChainBodyResult {
    const entries: TDChainEntry[] = [];
    let currentEntry: TDChainEntry | null = null;
    let currentSpeaker: string = defaultFilename;
    let epilogue: TDChainEpilogue = { type: TDEpilogueType.Exit };

    for (const stmt of statements) {
        if (!stmt.isKind(SyntaxKind.ExpressionStatement)) continue;

        const expr = stmt.getExpression();
        if (!Node.isCallExpression(expr)) continue;

        const funcName = expr.getExpression().getText();
        const args = expr.getArguments();

        switch (funcName) {
            case "from": {
                // from("SPEAKER") - switch speaker, no condition
                validateArgs("from", args, 1, expr.getStartLineNumber());
                if (currentEntry) {
                    entries.push(currentEntry);
                }
                currentSpeaker = utils.stripQuotes(args[0]!.getText());
                currentEntry = {
                    speaker: currentSpeaker,
                    texts: [],
                };
                break;
            }

            case "fromWhen": {
                // fromWhen("SPEAKER", condition) - switch speaker with condition
                validateArgs("fromWhen", args, 2, expr.getStartLineNumber());
                if (currentEntry) {
                    entries.push(currentEntry);
                }
                currentSpeaker = utils.stripQuotes(args[0]!.getText());
                const trigger = expressionToTrigger(args[1] as Expression, vars);
                currentEntry = {
                    speaker: currentSpeaker,
                    texts: [],
                    trigger,
                };
                break;
            }

            case SAY_KEYWORD: {
                if (args.length >= 2 && args[0] && args[1]) {
                    // say(speaker, text) - old form, still supported
                    currentEntry = processSayInChain(args, expr, currentEntry, entries, vars);
                    if (currentEntry?.speaker) {
                        currentSpeaker = currentEntry.speaker;
                    }
                } else if (args.length >= 1 && args[0]) {
                    // say(text) - add text to current entry
                    if (!currentEntry) {
                        // No from() yet - use default filename as speaker
                        currentEntry = {
                            speaker: currentSpeaker,
                            texts: [],
                        };
                    }
                    currentEntry.texts.push(expressionToText(args[0] as Expression, vars));
                }
                break;
            }

            case "action": {
                if (args.length === 0) {
                    throw TranspileError.fromNode(expr, `action() requires at least 1 argument`);
                }
                if (!currentEntry) {
                    throw TranspileError.fromNode(expr, `action() must come after say()`);
                }
                currentEntry.action = args.map((a) => expressionToActionString(a as Expression, vars)).join(" ");
                break;
            }

            case "exit":
                epilogue = { type: TDEpilogueType.Exit };
                break;

            case "goTo": {
                if (args.length < 1 || !args[0]) {
                    throw TranspileError.fromNode(expr, `goTo() requires at least 1 argument`);
                }
                epilogue = {
                    type: TDEpilogueType.End,
                    filename: defaultFilename,
                    target: resolveStringExpr(args[0] as Expression, vars),
                };
                break;
            }
        }
    }

    // Push final entry
    if (currentEntry) {
        entries.push(currentEntry);
    }

    return { entries, epilogue };
}

export { transformFunctionToChain, processChainStatements, processChainBody };
