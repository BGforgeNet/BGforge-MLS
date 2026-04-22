/**
 * TD Parser helpers - utility functions for expression evaluation,
 * argument validation, and parsing arrays/states/options.
 *
 * These are extracted from TDParser as standalone functions that
 * receive parser context (vars map) as a parameter.
 */

import {
    ArrayLiteralExpression,
    Expression,
    Node,
    SyntaxKind,
} from "ts-morph";
import * as utils from "../../common/transpiler-utils";
import type { VarsContext } from "../../common/transpiler-utils";
import { TranspileError } from "../../common/transpile-error";

/** Helper functions that should be resolved at evaluation time, not stored as raw text. */
const RESOLVED_HELPERS = new Set(["obj", "$obj", "tra", "$tra", "tlk", "$tlk"]);

/**
 * Evaluate an expression to a string value for variable storage.
 * Resolves known helper calls (obj, tra, tlk) so their results are stored
 * rather than the raw call text.
 */
function evaluateExpression(expr: Expression, vars: VarsContext): string | undefined {
    // Unwrap `as const` / `as Type` — the type assertion is irrelevant at compile time
    if (expr.isKind(SyntaxKind.AsExpression)) {
        return evaluateExpression(expr.getExpression(), vars);
    }

    if (expr.isKind(SyntaxKind.ArrayLiteralExpression)) {
        const elements = (expr as ArrayLiteralExpression)
            .getElements()
            .map(e => e.getText());
        return `[${elements.join(", ")}]`;
    }

    if (expr.isKind(SyntaxKind.StringLiteral) || expr.isKind(SyntaxKind.NumericLiteral)) {
        return expr.getText();
    }

    if (expr.isKind(SyntaxKind.Identifier)) {
        const name = expr.getText();
        return vars.get(name);
    }

    // Resolve known helpers (obj, tra, tlk) so variables store the evaluated
    // result rather than the raw call text. Without this, `const x = obj("npc")`
    // would store `obj("npc")` and pass it through verbatim in action strings.
    if (Node.isCallExpression(expr)) {
        const funcName = expr.getExpression().getText();
        if (RESOLVED_HELPERS.has(funcName)) {
            return expressionToActionString(expr, vars);
        }
    }

    return expr.getText();
}

/**
 * Resolve an array expression to its string elements.
 */
function resolveArrayElements(expr: Expression, vars: VarsContext): string[] | null {
    if (expr.isKind(SyntaxKind.ArrayLiteralExpression)) {
        // Use flattenArrayElements to support spread expressions
        return utils.flattenArrayElements(expr as ArrayLiteralExpression, vars);
    }

    if (expr.isKind(SyntaxKind.Identifier)) {
        const name = expr.getText();
        const value = vars.get(name);
        if (value && value.startsWith("[") && value.endsWith("]")) {
            // Use parseArrayLiteral to handle nested arrays correctly
            return utils.parseArrayLiteral(value);
        }
    }

    return null;
}

/**
 * Resolve an expression to its string value.
 * Handles string literals and variable references.
 */
function resolveStringExpr(expr: Expression, vars: VarsContext): string {
    if (Node.isStringLiteral(expr) || expr.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
        return utils.resolveStringLiteral(expr);
    }
    if (Node.isIdentifier(expr)) {
        const name = expr.getText();
        const value = vars.get(name);
        if (value !== undefined) {
            return utils.stripQuotes(value);
        }
        return name;
    }
    return utils.stripQuotes(expr.getText());
}

/**
 * Convert an expression to a D action string.
 * Function calls are serialized as FunctionName(arg1,arg2,...).
 * Handles tra/$tra → @N, tlk/$tlk → #N, obj/$obj → object reference.
 */
function expressionToActionString(expr: Expression, vars: VarsContext): string {
    if (Node.isCallExpression(expr)) {
        const funcName = expr.getExpression().getText();
        const args = expr.getArguments();

        // tra(123) or $tra(123) => @123
        if ((funcName === "tra" || funcName === "$tra") && args.length >= 1 && args[0]) {
            return `@${utils.substituteVars(args[0].getText(), vars)}`;
        }

        // tlk(123) or $tlk(123) => bare number in action strings
        // (# prefix is only for D text contexts like SAY/REPLY)
        if ((funcName === "tlk" || funcName === "$tlk") && args.length >= 1 && args[0]) {
            return utils.substituteVars(args[0].getText(), vars);
        }

        // obj("[ANYONE]") or $obj("[ANYONE]") => [ANYONE]
        // obj("string") or $obj("string") => "string"
        if ((funcName === "obj" || funcName === "$obj") && args.length >= 1 && args[0]) {
            const raw = utils.stripQuotes(args[0].getText());
            if (raw.startsWith("[") && raw.endsWith("]")) {
                return raw;
            }
            return `"${raw}"`;
        }

        const argStrings = args.map(a => expressionToActionString(a as Expression, vars));
        return `${funcName}(${argStrings.join(",")})`;
    }

    if (Node.isStringLiteral(expr)) {
        // Keep quotes for string arguments
        return expr.getText();
    }

    if (Node.isNumericLiteral(expr)) {
        return expr.getText();
    }

    if (Node.isIdentifier(expr)) {
        // Could be a constant or identifier - substitute if known
        const name = expr.getText();
        const value = vars.get(name);
        if (value !== undefined) return value;
        // Scope constants (GLOBAL, LOCALS, MYAREA) arrive as bare identifiers
        // because ielib can't be bundled — quote them for WeiDU output
        if (utils.SCOPE_CONSTANTS.has(name)) return `"${name}"`;
        return name;
    }

    // Fallback to raw text
    return utils.substituteVars(expr.getText(), vars);
}

/**
 * Validate function call has required number of arguments.
 */
function validateArgs(funcName: string, args: Node[], minArgs: number, lineNumber: number) {
    if (args.length < minArgs) {
        const argWord = minArgs === 1 ? "argument" : "arguments";
        throw new TranspileError(
            `${funcName}() requires at least ${minArgs} ${argWord}`,
            { line: lineNumber }
        );
    }
}

/**
 * Parse a state list (array of strings/numbers or single value).
 */
function parseStateList(expr: Expression, vars: VarsContext): (string | number)[] {
    if (Node.isArrayLiteralExpression(expr)) {
        return expr.getElements().map((e) => {
            const text = e.getText();
            // Check if it's a number or string
            if (/^\d+$/.test(text)) {
                return Number(text);
            }
            return resolveStringExpr(e as Expression, vars);
        });
    }

    // Single value
    const text = expr.getText();
    if (/^\d+$/.test(text)) {
        return [Number(text)];
    }
    return [resolveStringExpr(expr, vars)];
}

/**
 * Parse an array of numbers.
 */
function parseNumberArray(expr: Expression): number[] {
    if (!Node.isArrayLiteralExpression(expr)) {
        throw TranspileError.fromNode(expr, `Expected array of numbers`);
    }

    return expr.getElements().map((e) => Number(e.getText()));
}

/**
 * Parse unless option (can be string or object with { unless: "..." }).
 */
function parseUnless(expr: Expression): string | undefined {
    if (Node.isObjectLiteralExpression(expr)) {
        for (const prop of expr.getProperties()) {
            if (Node.isPropertyAssignment(prop) && prop.getName() === "unless") {
                const value = prop.getInitializer();
                if (value) {
                    return utils.stripQuotes(value.getText());
                }
            }
        }
        return undefined;
    }

    return utils.stripQuotes(expr.getText());
}


/**
 * Extract a boolean option from an optional ObjectLiteralExpression argument.
 * Returns true if the property exists and its initializer text is "true".
 */
function parseBooleanOption(arg: Node | undefined, propertyName: string): boolean {
    if (!arg || !Node.isObjectLiteralExpression(arg)) return false;
    for (const prop of arg.getProperties()) {
        if (Node.isPropertyAssignment(prop) && prop.getName() === propertyName) {
            return prop.getInitializer()?.getText() === "true";
        }
    }
    return false;
}

/**
 * Extract a string option from an optional ObjectLiteralExpression argument.
 * Returns the stripped string value if found, undefined otherwise.
 */
function parseStringOption(arg: Node | undefined, propertyName: string): string | undefined {
    if (!arg || !Node.isObjectLiteralExpression(arg)) return undefined;
    for (const prop of arg.getProperties()) {
        if (Node.isPropertyAssignment(prop) && prop.getName() === propertyName) {
            const value = prop.getInitializer();
            if (value) return utils.stripQuotes(value.getText());
        }
    }
    return undefined;
}

/**
 * Parse a numeric value from a Node's text.
 * Throws with a descriptive error if the value is not a valid number.
 */
function parseRequiredNumber(arg: Node, context: string, lineNumber: number): number {
    const value = Number(arg.getText());
    if (Number.isNaN(value)) {
        throw new TranspileError(
            `Expected numeric value for ${context}, got "${arg.getText()}"`,
            { line: lineNumber }
        );
    }
    return value;
}

/**
 * Retrieve a call argument narrowed to Expression with bounds and type guards.
 *
 * ts-morph's getArguments() returns Node[] even though call arguments are always
 * Expression nodes — the loose return type is a known API limitation. This helper
 * performs an explicit bounds check and a Node.isExpression() runtime guard so
 * callers avoid scattered `args[N] as Expression` casts throughout patch-operations.
 */
function getCallArg(args: readonly Node[], index: number, callExpr: Node): Expression {
    const arg = args[index];
    if (arg === undefined) {
        throw TranspileError.fromNode(callExpr, `Expected argument at index ${index}`);
    }
    // Node.isExpression() is ts-morph's own type guard — if this ever fails
    // it indicates a ts-morph API contract violation, not user input error.
    if (!Node.isExpression(arg)) {
        throw TranspileError.fromNode(callExpr, `Argument at index ${index} is not an expression`);
    }
    return arg;
}

export {
    evaluateExpression,
    resolveArrayElements,
    resolveStringExpr,
    expressionToActionString,
    validateArgs,
    parseStateList,
    parseNumberArray,
    parseUnless,
    parseBooleanOption,
    parseStringOption,
    parseRequiredNumber,
    getCallArg,
};
