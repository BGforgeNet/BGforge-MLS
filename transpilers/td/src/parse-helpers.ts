/**
 * TD parser helpers: the compile-time values a TD construct reads - names, state labels, integers, lists,
 * options, actions - each produced by the evaluator (`common/compile-time-eval.ts`) from the syntax tree and
 * refused, naming the expression, when it is not the kind the construct takes.
 */

import {
    type CallExpression,
    type Expression,
    type ForOfStatement,
    type ForStatement,
    type Statement,
    Node,
} from "ts-morph";
import { type Scope, declareStatements, evaluate, unrollFor, unrollForOf } from "../../common/compile-time-eval";
import {
    describeKind,
    formatArgument,
    type ArgumentStyle,
    type FunctionValue,
    type Value,
} from "../../common/compile-time-value";
import { getBlockStatements } from "../../common/transpiler-utils";
import { TranspileError } from "../../common/transpile-error";

/** D actions and triggers in TD's compact form: `SetGlobal("x","GLOBAL",1)`. */
const TD_ARGUMENTS: ArgumentStyle = { separator: "," };

function refuse(node: Node, message: string): TranspileError {
    return TranspileError.fromNode(node, message);
}

/** An engine call in D's spelling, its arguments as WeiDU reads them. */
function formatCall(name: string, args: readonly Value[], node: Node): string {
    return formatArgument({ kind: "call", name, args }, TD_ARGUMENTS, node);
}

/** The D action `expr` performs. */
function actionOf(expr: Expression, scope: Scope): string {
    const value = evaluate(expr, scope);
    if (value.kind !== "call") throw refuse(expr, `'${expr.getText()}' is a value, not an action`);
    return formatCall(value.name, value.args, expr);
}

/** The actions of an `action(...)` call, as one D action list. */
function actionsOf(args: readonly Expression[], scope: Scope): string {
    return args.map((arg) => actionOf(arg, scope)).join(" ");
}

/** A dialog file, speaker or variable name: a string, or an engine name the source leaves unbound. */
function nameOf(expr: Expression, scope: Scope, what: string): string {
    const value = evaluate(expr, scope);
    if (value.kind === "string") return value.value;
    if (value.kind === "symbol") return value.name;
    throw refuse(expr, `${what} is a string, not ${describeKind(value)}`);
}

/**
 * A state: a function the source declares, or one a body-less `declare function` names, by its name; a label
 * string as written; a state number.
 */
function labelOfValue(value: Value, node: Node): string {
    switch (value.kind) {
        case "function":
            return value.name;
        case "symbol":
            return value.name;
        case "string":
            return value.value;
        case "int":
            return String(value.value);
        default:
            throw refuse(
                node,
                `a state is named by a function, a label string or a state number, not ${describeKind(value)}`,
            );
    }
}

function stateLabelOf(expr: Expression, scope: Scope): string {
    return labelOfValue(evaluate(expr, scope), expr);
}

function integerOf(expr: Expression, scope: Scope, what: string): number {
    const value = evaluate(expr, scope);
    if (value.kind !== "int") throw refuse(expr, `${what} is an integer, not ${describeKind(value)}`);
    return value.value;
}

/** A patch operation's states: one state, or an array of them, each a number or a label. */
function stateListOf(expr: Expression, scope: Scope): (string | number)[] {
    const value = evaluate(expr, scope);
    const items = value.kind === "array" ? value.items : [value];
    return items.map((item) => (item.kind === "int" ? item.value : labelOfValue(item, expr)));
}

/** An array of integers: a patch operation's transition numbers. */
function integerListOf(expr: Expression, scope: Scope, what: string): number[] {
    const value = evaluate(expr, scope);
    if (value.kind !== "array") throw refuse(expr, `${what} is an array of integers, not ${describeKind(value)}`);
    return value.items.map((item) => {
        if (item.kind !== "int") throw refuse(expr, `${what} holds integers, not ${describeKind(item)}`);
        return item.value;
    });
}

/** An options object's fields, refused unless it is an object holding only the options `allowed` names. */
function optionsOf(
    expr: Expression | undefined,
    scope: Scope,
    allowed: readonly string[],
    construct: string,
): ReadonlyMap<string, Value> {
    if (expr === undefined) return new Map();
    const value = evaluate(expr, scope);
    if (value.kind !== "record") throw refuse(expr, `${construct}() takes its options as an object`);
    for (const key of value.fields.keys()) {
        if (!allowed.includes(key)) {
            throw refuse(expr, `${construct}() has no option '${key}'; it takes ${allowed.join(", ")}`);
        }
    }
    return value.fields;
}

function booleanOption(options: ReadonlyMap<string, Value>, key: string, node: Node): boolean {
    const value = options.get(key);
    if (value === undefined) return false;
    if (value.kind !== "bool") throw refuse(node, `the option '${key}' is a boolean, not ${describeKind(value)}`);
    return value.value;
}

/** A patch operation's UNLESS condition: a string, or `{ unless }`, as WeiDU reads it. */
function unlessOf(expr: Expression | undefined, scope: Scope, construct: string): string | undefined {
    if (expr === undefined) return undefined;
    const value = evaluate(expr, scope);
    if (value.kind !== "record") return unlessValue(value, expr);
    return unlessValue(optionsOf(expr, scope, ["unless"], construct).get("unless"), expr);
}

function unlessValue(value: Value | undefined, node: Node): string | undefined {
    if (value === undefined) return undefined;
    if (value.kind !== "string") throw refuse(node, `an UNLESS condition is a string, not ${describeKind(value)}`);
    return value.value;
}

/** A string a patch operation searches for or replaces with: the author's text, emitted as written. */
function patchTextOf(expr: Expression, scope: Scope, what: string): string {
    const value = evaluate(expr, scope);
    if (value.kind !== "string") throw refuse(expr, `${what} is a string, not ${describeKind(value)}`);
    return value.value;
}

/** A child scope holding the block's own constants and functions. */
function blockScope(scope: Scope, statements: readonly Statement[]): Scope {
    const inner = scope.child();
    declareStatements(inner, statements);
    return inner;
}

/** A statement that only declares: its names are bound by `declareStatements`, and it emits nothing itself. */
function isDeclaration(statement: Statement): boolean {
    return (
        Node.isVariableStatement(statement) ||
        Node.isFunctionDeclaration(statement) ||
        Node.isEmptyStatement(statement) ||
        Node.isInterfaceDeclaration(statement) ||
        Node.isTypeAliasDeclaration(statement) ||
        (Node.isModuleDeclaration(statement) && statement.hasDeclareKeyword()) ||
        (Node.isEnumDeclaration(statement) && statement.hasDeclareKeyword())
    );
}

/** Runs `onBody` once per pass of a compile-time loop, the body's statements in a scope of their own. */
function unrollLoop(
    loop: ForStatement | ForOfStatement,
    scope: Scope,
    onBody: (statements: Statement[], scope: Scope) => void,
): void {
    const statements = getBlockStatements(loop.getStatement());
    const onIteration = (iteration: Scope) => onBody(statements, blockScope(iteration, statements));
    if (Node.isForStatement(loop)) unrollFor(loop, scope, onIteration);
    else unrollForOf(loop, scope, onIteration);
}

/** The function the source declares that `call` calls, to inline in place of the call; undefined otherwise. */
function calledHelper(call: CallExpression, scope: Scope): FunctionValue | undefined {
    const callee = call.getExpression();
    if (!Node.isIdentifier(callee)) return undefined;
    const bound = scope.lookup(callee.getText(), callee);
    return bound?.kind === "function" ? bound : undefined;
}

/**
 * Validate function call has required number of arguments.
 */
function validateArgs(funcName: string, args: Node[], minArgs: number, lineNumber: number) {
    if (args.length < minArgs) {
        const argWord = minArgs === 1 ? "argument" : "arguments";
        throw new TranspileError(`${funcName}() requires at least ${minArgs} ${argWord}`, { line: lineNumber });
    }
}

/**
 * Retrieve a call argument narrowed to Expression with bounds and type guards.
 *
 * ts-morph's getArguments() returns Node[] even though call arguments are always
 * Expression nodes - the loose return type is a known API limitation. This helper
 * performs an explicit bounds check and a Node.isExpression() runtime guard so
 * callers avoid scattered `args[N] as Expression` casts throughout patch-operations.
 */
function getCallArg(args: readonly Node[], index: number, callExpr: Node): Expression {
    const arg = args[index];
    if (arg === undefined) {
        throw TranspileError.fromNode(callExpr, `Expected argument at index ${index}`);
    }
    // Node.isExpression() is ts-morph's own type guard - if this ever fails
    // it indicates a ts-morph API contract violation, not user input error.
    if (!Node.isExpression(arg)) {
        throw TranspileError.fromNode(callExpr, `Argument at index ${index} is not an expression`);
    }
    return arg;
}

/** The argument at `index`, if the call has one. */
function optionalCallArg(args: readonly Node[], index: number, callExpr: Node): Expression | undefined {
    return index < args.length ? getCallArg(args, index, callExpr) : undefined;
}

/**
 * Narrow every entry in a call's argument list to Expression at once.
 *
 * Sibling helper to getCallArg, used at sites that iterate over `args` and would
 * otherwise sprinkle `arg as Expression` inside the loop body (e.g. variadic
 * `say(...)` and `action(...)` collectors). The runtime check is identical;
 * narrowing the whole array here keeps the per-iteration body free of casts.
 */
function getCallArgs(args: readonly Node[], callExpr: Node): Expression[] {
    return args.map((arg, index) => {
        if (!Node.isExpression(arg)) {
            throw TranspileError.fromNode(callExpr, `Argument at index ${index} is not an expression`);
        }
        return arg;
    });
}

export {
    actionsOf,
    blockScope,
    booleanOption,
    calledHelper,
    formatCall,
    getCallArg,
    getCallArgs,
    integerListOf,
    integerOf,
    isDeclaration,
    labelOfValue,
    nameOf,
    optionalCallArg,
    optionsOf,
    patchTextOf,
    stateLabelOf,
    stateListOf,
    unlessOf,
    unlessValue,
    unrollLoop,
    validateArgs,
};
