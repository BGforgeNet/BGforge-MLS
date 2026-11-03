/**
 * The compile-time evaluator TBAF and TD share: expressions to `Value`s, conditions to folded trees, and
 * `for`/`for...of` loops to one scope per iteration.
 *
 * It reads the syntax tree and follows TypeScript's meaning, or refuses with a `TranspileError` naming the
 * construct - it never passes source text through for the output to carry. A binding is evaluated when something
 * reads it, never on declaration, so a declaration nothing reads (a library's runtime class the bundler inlined)
 * costs nothing and cannot refuse.
 */

import {
    Node,
    SyntaxKind,
    type BinaryExpression,
    type CallExpression,
    type Expression,
    type ForOfStatement,
    type ForStatement,
    type FunctionDeclaration,
    type SourceFile,
    type Statement,
} from "ts-morph";
import { TranspileError } from "./transpile-error";
import { getSharedProject } from "./shared-project";
import { describeKind, INT32_MAX, INT32_MIN, type FunctionValue, type StrRef, type Value } from "./compile-time-value";
import { MAX_LOOP_ITERATIONS, SCOPE_CONSTANTS } from "./transpiler-utils";

type Binding =
    | { readonly state: "pending"; readonly initializer: Expression; readonly scope: Scope }
    | { readonly state: "evaluating" }
    | { readonly state: "uninitialized" }
    | { readonly state: "done"; readonly value: Value };

/** One lexical scope: the module, a function call, a block, a loop iteration. */
export class Scope {
    private readonly bindings = new Map<string, Binding>();
    private readonly parent: Scope | undefined;

    constructor(parent?: Scope) {
        this.parent = parent;
    }

    child(): Scope {
        return new Scope(this);
    }

    /** A declaration whose initializer is evaluated, in this scope, the first time something reads it. */
    declare(name: string, initializer: Expression | undefined): void {
        this.bindings.set(
            name,
            initializer === undefined ? { state: "uninitialized" } : { state: "pending", initializer, scope: this },
        );
    }

    /** A name whose value is already known: a parameter, a loop variable. */
    bind(name: string, value: Value): void {
        this.bindings.set(name, { state: "done", value });
    }

    declareFunction(declaration: FunctionDeclaration): void {
        const name = declaration.getName();
        if (name === undefined) return;
        this.bind(name, { kind: "function", name, declaration, closure: this });
    }

    /** The value `name` holds where `at` reads it, or undefined for a name no enclosing scope binds. */
    lookup(name: string, at: Node): Value | undefined {
        const binding = this.bindings.get(name);
        if (binding !== undefined) return this.resolve(name, binding, at);
        return this.parent?.lookup(name, at);
    }

    private resolve(name: string, binding: Binding, at: Node): Value {
        switch (binding.state) {
            case "done":
                return binding.value;
            case "uninitialized":
                throw refuse(at, `'${name}' is declared without a value`);
            case "evaluating":
                throw refuse(at, `'${name}' is defined in terms of itself`);
            case "pending": {
                this.bindings.set(name, { state: "evaluating" });
                try {
                    const value = evaluate(binding.initializer, binding.scope);
                    this.bindings.set(name, { state: "done", value });
                    return value;
                } catch (error) {
                    this.bindings.set(name, binding);
                    throw error;
                }
            }
        }
    }
}

function refuse(node: Node, message: string): TranspileError {
    return TranspileError.fromNode(node, message);
}

/**
 * Declares a statement list's constants and functions in `scope`. Other statements are the front end's to walk;
 * this only makes their names readable, in whatever order the statements reference each other.
 */
export function declareStatements(scope: Scope, statements: readonly Statement[]): void {
    for (const statement of statements) {
        if (Node.isVariableStatement(statement)) {
            if (statement.hasDeclareKeyword()) continue;
            for (const declaration of statement.getDeclarations()) {
                if (!Node.isIdentifier(declaration.getNameNode())) {
                    throw refuse(declaration, "destructuring is not supported here; declare each constant separately");
                }
                scope.declare(declaration.getName(), declaration.getInitializer());
            }
        } else if (Node.isFunctionDeclaration(statement)) {
            // A body-less declaration is the engine's vocabulary, so its name stays unbound.
            if (statement.getBody() !== undefined) scope.declareFunction(statement);
        }
    }
}

/**
 * Refuses a `let` or `var` anywhere but a loop header. A compile-time value cannot change once the output is
 * written, so only `const` declares one; `let` stays for the counter a loop updates. Run on each source the author
 * wrote, before bundling: the bundler rewrites a top-level `const` to `var`, which would read as the author's.
 */
export function checkDeclarationKinds(source: SourceFile): void {
    for (const list of source.getDescendantsOfKind(SyntaxKind.VariableDeclarationList)) {
        const keyword = list.getFirstChild()?.getKind();
        if (keyword === SyntaxKind.ConstKeyword) continue;
        const parent = list.getParent();
        const inLoopHeader =
            (Node.isForStatement(parent) || Node.isForOfStatement(parent)) && parent.getInitializer() === list;
        if (keyword === SyntaxKind.LetKeyword && inLoopHeader) continue;
        const ambient = Node.isVariableStatement(parent) && parent.hasDeclareKeyword();
        if (ambient) continue;
        const word = keyword === SyntaxKind.VarKeyword ? "var" : "let";
        throw refuse(
            list,
            inLoopHeader
                ? `'${word}' is not supported; a loop counter is declared with let`
                : `'${word}' declares a value that can change, which a compile-time value cannot; use const`,
        );
    }
}

/** `checkDeclarationKinds` on a source's text, naming `file` in a refusal: the check TBAF and TD give `bundle()`. */
export function checkSourceDeclarations(file: string, text: string): void {
    const source = getSharedProject().createSourceFile("declaration-check.ts", text, { overwrite: true });
    try {
        checkDeclarationKinds(source);
    } catch (error) {
        throw TranspileError.wrap(error, { file });
    }
}

/** Type syntax erases: the expression under it is the value. */
function unwrap(expr: Expression): Expression {
    let inner: Expression = expr;
    for (;;) {
        if (
            Node.isParenthesizedExpression(inner) ||
            Node.isAsExpression(inner) ||
            Node.isSatisfiesExpression(inner) ||
            Node.isNonNullExpression(inner) ||
            Node.isTypeAssertion(inner)
        ) {
            inner = inner.getExpression();
        } else {
            return inner;
        }
    }
}

/** Names whose call builds a reference rather than reaching the engine, whatever the bundle binds them to. */
const INTRINSICS: ReadonlySet<string> = new Set(["obj", "$obj", "tra", "$tra", "tlk", "$tlk", "tlkForced"]);

/** Globals with no compile-time integer value; unbound, they would otherwise read as engine names. */
const NON_VALUES: ReadonlySet<string> = new Set(["undefined", "NaN", "Infinity", "globalThis"]);

/** The compile-time value of `expr` in `scope`. */
export function evaluate(expr: Expression, scope: Scope): Value {
    const node = unwrap(expr);

    if (Node.isNumericLiteral(node)) return intLiteral(node.getLiteralValue(), node.getText(), node);
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
        return { kind: "string", value: node.getLiteralValue() };
    }
    if (Node.isTemplateExpression(node)) {
        let text = node.getHead().getLiteralText();
        for (const span of node.getTemplateSpans()) {
            const part = evaluate(span.getExpression(), scope);
            if (part.kind === "string") text += part.value;
            else if (part.kind === "int") text += String(part.value);
            else
                throw refuse(
                    span.getExpression(),
                    `a template literal joins strings and integers, not ${describeKind(part)}`,
                );
            text += span.getLiteral().getLiteralText();
        }
        return { kind: "string", value: text };
    }
    if (node.isKind(SyntaxKind.TrueKeyword)) return { kind: "bool", value: true };
    if (node.isKind(SyntaxKind.FalseKeyword)) return { kind: "bool", value: false };
    if (Node.isIdentifier(node)) return evaluateIdentifier(node.getText(), scope, node);
    if (Node.isPrefixUnaryExpression(node))
        return evaluatePrefix(node.getOperatorToken(), node.getOperand(), scope, node);
    if (Node.isBinaryExpression(node)) return evaluateBinary(node, scope);
    if (Node.isConditionalExpression(node)) {
        const condition = evaluate(node.getCondition(), scope);
        if (condition.kind !== "bool") {
            throw refuse(node.getCondition(), `a ternary needs a compile-time boolean, not ${describeKind(condition)}`);
        }
        return evaluate(condition.value ? node.getWhenTrue() : node.getWhenFalse(), scope);
    }
    if (Node.isArrayLiteralExpression(node)) {
        const items: Value[] = [];
        for (const element of node.getElements()) items.push(...spreadOrValue(element, scope));
        return { kind: "array", items };
    }
    if (Node.isObjectLiteralExpression(node)) return evaluateRecord(node.getProperties(), scope);
    if (Node.isPropertyAccessExpression(node)) {
        if (node.hasQuestionDotToken()) throw refuse(node, "'?.' is not supported; a compile-time value is never null");
        return fieldOf(evaluate(node.getExpression(), scope), node.getName(), node);
    }
    if (Node.isElementAccessExpression(node)) {
        if (node.hasQuestionDotToken()) throw refuse(node, "'?.' is not supported; a compile-time value is never null");
        const argument = node.getArgumentExpression();
        if (argument === undefined) throw refuse(node, "an element access needs an index");
        return elementAt(evaluate(node.getExpression(), scope), evaluate(argument, scope), node);
    }
    if (Node.isCallExpression(node)) return evaluateCall(node, scope);
    throw refuse(node, `${node.getKindName()} has no compile-time value`);
}

function intLiteral(value: number, text: string, node: Node): Value {
    if (!Number.isInteger(value)) throw refuse(node, `${text} is not an integer; WeiDU reads integers only`);
    const hex = /^0x[0-9a-f]+$/i.test(text);
    // WeiDU reads a hex literal up to 0xFFFFFFFF as the 32-bit pattern it spells, and a decimal one only in range.
    // oxlint-disable-next-line unicorn/prefer-math-trunc -- `| 0` wraps 0x80000000..0xFFFFFFFF to the negative int32 WeiDU reads; Math.trunc would not.
    if (hex && value <= 0xffffffff) return { kind: "int", value: value | 0, text };
    return checkedInt(value, node);
}

function checkedInt(value: number, node: Node): Value {
    if (!Number.isInteger(value) || value < INT32_MIN || value > INT32_MAX) {
        const text = node.getText();
        const computed = text === String(value) ? text : `${text} is ${value}, which`;
        throw refuse(node, `${computed} does not fit in 32 bits`);
    }
    return { kind: "int", value };
}

function evaluateIdentifier(name: string, scope: Scope, node: Node): Value {
    const bound = scope.lookup(name, node);
    if (bound !== undefined) return bound;
    if (NON_VALUES.has(name)) throw refuse(node, `'${name}' has no compile-time value`);
    // Unbound, these reach the output quoted, as the scope argument of a variable action or trigger.
    if (SCOPE_CONSTANTS.has(name)) return { kind: "string", value: name };
    return { kind: "symbol", name };
}

function evaluatePrefix(operator: SyntaxKind, operandExpr: Expression, scope: Scope, node: Node): Value {
    if (operator === SyntaxKind.PlusPlusToken || operator === SyntaxKind.MinusMinusToken) {
        throw refuse(node, "a compile-time value cannot change; only a loop's incrementor updates its counter");
    }
    // `-2147483648` is one literal to TypeScript; checking 2147483648 alone first would refuse it.
    const literal = unwrap(operandExpr);
    if (operator === SyntaxKind.MinusToken && Node.isNumericLiteral(literal)) {
        if (!Number.isInteger(literal.getLiteralValue()))
            return intLiteral(literal.getLiteralValue(), node.getText(), node);
        return checkedInt(-literal.getLiteralValue(), node);
    }
    const operand = evaluate(operandExpr, scope);
    if (operator === SyntaxKind.ExclamationToken) {
        if (operand.kind !== "bool")
            throw refuse(node, `'!' needs a compile-time boolean, not ${describeKind(operand)}`);
        return { kind: "bool", value: !operand.value };
    }
    const value = intOperand(operand, operandExpr);
    if (operator === SyntaxKind.MinusToken) return checkedInt(-value, node);
    if (operator === SyntaxKind.PlusToken) return { kind: "int", value };
    // operator === SyntaxKind.TildeToken
    return { kind: "int", value: ~value };
}

function intOperand(value: Value, node: Node): number {
    if (value.kind !== "int") throw refuse(node, `an integer was expected, not ${describeKind(value)}`);
    return value.value;
}

function evaluateBinary(node: BinaryExpression, scope: Scope): Value {
    const operator = node.getOperatorToken().getKind();
    const leftExpr = node.getLeft();
    const rightExpr = node.getRight();

    // Short-circuit as TypeScript does: the right side is read only when the left does not decide.
    if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
        const left = boolOperand(evaluate(leftExpr, scope), leftExpr, operator);
        if (left === (operator === SyntaxKind.BarBarToken)) return { kind: "bool", value: left };
        return { kind: "bool", value: boolOperand(evaluate(rightExpr, scope), rightExpr, operator) };
    }
    if (operator === SyntaxKind.QuestionQuestionToken) {
        throw refuse(node, "'??' is not supported; a compile-time value is never null");
    }
    if (isAssignment(operator)) {
        throw refuse(node, "a compile-time value cannot change; only a loop's incrementor updates its counter");
    }

    const left = evaluate(leftExpr, scope);
    const right = evaluate(rightExpr, scope);
    const text = node.getOperatorToken().getText();

    if (operator === SyntaxKind.PlusToken && (left.kind === "string" || right.kind === "string")) {
        return { kind: "string", value: concatPart(left, leftExpr) + concatPart(right, rightExpr) };
    }
    if (
        operator === SyntaxKind.EqualsEqualsEqualsToken ||
        operator === SyntaxKind.EqualsEqualsToken ||
        operator === SyntaxKind.ExclamationEqualsEqualsToken ||
        operator === SyntaxKind.ExclamationEqualsToken
    ) {
        const equal = sameValue(left, right, node, text);
        const negated =
            operator === SyntaxKind.ExclamationEqualsEqualsToken || operator === SyntaxKind.ExclamationEqualsToken;
        return { kind: "bool", value: negated ? !equal : equal };
    }

    const a = intOperand(left, leftExpr);
    const b = intOperand(right, rightExpr);
    switch (operator) {
        case SyntaxKind.LessThanToken:
            return { kind: "bool", value: a < b };
        case SyntaxKind.LessThanEqualsToken:
            return { kind: "bool", value: a <= b };
        case SyntaxKind.GreaterThanToken:
            return { kind: "bool", value: a > b };
        case SyntaxKind.GreaterThanEqualsToken:
            return { kind: "bool", value: a >= b };
        case SyntaxKind.PlusToken:
            return checkedInt(a + b, node);
        case SyntaxKind.MinusToken:
            return checkedInt(a - b, node);
        case SyntaxKind.AsteriskToken:
            return checkedInt(a * b, node);
        case SyntaxKind.AsteriskAsteriskToken:
            return checkedInt(a ** b, node);
        case SyntaxKind.SlashToken: {
            if (b === 0) throw refuse(node, "division by zero");
            if (a % b !== 0) {
                throw refuse(
                    node,
                    `${node.getText()} is ${a / b}, not an integer; write Math.trunc(${node.getText()}) or ` +
                        `Math.floor(${node.getText()}) for integer division`,
                );
            }
            return checkedInt(a / b, node);
        }
        case SyntaxKind.PercentToken:
            if (b === 0) throw refuse(node, "division by zero");
            return { kind: "int", value: a % b };
        // Bitwise operators work on 32-bit patterns, so their results wrap exactly as TypeScript's do.
        case SyntaxKind.BarToken:
            return { kind: "int", value: a | b };
        case SyntaxKind.AmpersandToken:
            return { kind: "int", value: a & b };
        case SyntaxKind.CaretToken:
            return { kind: "int", value: a ^ b };
        case SyntaxKind.LessThanLessThanToken:
            return { kind: "int", value: a << b };
        case SyntaxKind.GreaterThanGreaterThanToken:
            return { kind: "int", value: a >> b };
        case SyntaxKind.GreaterThanGreaterThanGreaterThanToken:
            return checkedInt(a >>> b, node);
        default:
            throw refuse(node, `'${text}' has no compile-time meaning`);
    }
}

function isAssignment(operator: SyntaxKind): boolean {
    return operator >= SyntaxKind.FirstAssignment && operator <= SyntaxKind.LastAssignment;
}

function boolOperand(value: Value, node: Node, operator: SyntaxKind): boolean {
    if (value.kind !== "bool") {
        const text = operator === SyntaxKind.AmpersandAmpersandToken ? "&&" : "||";
        throw refuse(node, `'${text}' needs compile-time booleans, not ${describeKind(value)}`);
    }
    return value.value;
}

function concatPart(value: Value, node: Node): string {
    if (value.kind === "string") return value.value;
    if (value.kind === "int") return String(value.value);
    throw refuse(node, `'+' joins strings and integers, not ${describeKind(value)}`);
}

function sameValue(left: Value, right: Value, node: Node, operator: string): boolean {
    for (const side of [left, right]) {
        if (side.kind === "symbol" || side.kind === "call") {
            throw refuse(node, `'${operator}' compares compile-time values, and one side is ${describeKind(side)}`);
        }
    }
    if ((left.kind === "int" || left.kind === "string" || left.kind === "bool") && left.kind === right.kind) {
        return left.value === right.value;
    }
    throw refuse(node, `'${operator}' compares ${describeKind(left)} with ${describeKind(right)}`);
}

function spreadOrValue(element: Expression, scope: Scope): Value[] {
    if (!Node.isSpreadElement(element)) return [evaluate(element, scope)];
    const spread = evaluate(element.getExpression(), scope);
    if (spread.kind !== "array") throw refuse(element, `only an array spreads, not ${describeKind(spread)}`);
    return [...spread.items];
}

function evaluateRecord(properties: readonly Node[], scope: Scope): Value {
    const fields = new Map<string, Value>();
    for (const property of properties) {
        if (Node.isPropertyAssignment(property)) {
            const nameNode = property.getNameNode();
            if (Node.isComputedPropertyName(nameNode)) {
                throw refuse(property, "a computed property name is not supported; name the field");
            }
            const initializer = property.getInitializer();
            if (initializer === undefined) throw refuse(property, "a field needs a value");
            fields.set(
                Node.isStringLiteral(nameNode) ? nameNode.getLiteralValue() : nameNode.getText(),
                evaluate(initializer, scope),
            );
        } else if (Node.isShorthandPropertyAssignment(property)) {
            fields.set(property.getName(), evaluateIdentifier(property.getName(), scope, property));
        } else if (Node.isSpreadAssignment(property)) {
            const spread = evaluate(property.getExpression(), scope);
            if (spread.kind !== "record")
                throw refuse(property, `only an object spreads here, not ${describeKind(spread)}`);
            for (const [name, value] of spread.fields) fields.set(name, value);
        } else {
            throw refuse(property, `${property.getKindName()} has no compile-time value`);
        }
    }
    return { kind: "record", fields };
}

function fieldOf(target: Value, name: string, node: Node): Value {
    if (target.kind === "record") {
        const value = target.fields.get(name);
        if (value === undefined) throw refuse(node, `the object has no field '${name}'`);
        return value;
    }
    if (name === "length" && target.kind === "array") return { kind: "int", value: target.items.length };
    if (name === "length" && target.kind === "string") return { kind: "int", value: target.value.length };
    throw refuse(node, `'${node.getText()}': ${describeKind(target)} has no field '${name}' at compile time`);
}

function elementAt(target: Value, index: Value, node: Node): Value {
    if (target.kind === "array" && index.kind === "int") {
        const item = target.items[index.value];
        if (item === undefined) {
            throw refuse(node, `index ${index.value} is outside the array, which has ${target.items.length} elements`);
        }
        return item;
    }
    if (target.kind === "record" && index.kind === "string") return fieldOf(target, index.value, node);
    throw refuse(node, `${describeKind(target)} cannot be indexed by ${describeKind(index)}`);
}

function evaluateCall(node: CallExpression, scope: Scope): Value {
    const callee = node.getExpression();
    if (Node.isIdentifier(callee)) {
        const name = callee.getText();
        if (INTRINSICS.has(name)) return intrinsic(name, node, scope);
        const bound = scope.lookup(name, callee);
        if (bound?.kind === "function") {
            const { body, result } = bindCall(bound, node, scope);
            return evaluate(result, body);
        }
        if (bound !== undefined) throw refuse(callee, `'${name}' is ${describeKind(bound)}, not a function`);
        return { kind: "call", name, args: engineArguments(node, scope) };
    }
    if (Node.isPropertyAccessExpression(callee) && callee.getExpression().getText() === "Math") {
        return math(callee.getName(), node, scope);
    }
    throw refuse(node, `only a named function is called at compile time, not '${callee.getText()}'`);
}

/** A call's arguments as the expressions they always are; ts-morph types them as `Node`. */
function callArguments(node: CallExpression): Expression[] {
    return node.getArguments().map((arg) => {
        if (!Node.isExpression(arg)) throw refuse(arg, `${arg.getKindName()} is not an argument expression`);
        return arg;
    });
}

/** An engine call's arguments, an array spread among them expanding to its elements. */
function engineArguments(node: CallExpression, scope: Scope): Value[] {
    return callArguments(node).flatMap((arg) => spreadOrValue(arg, scope));
}

/** The call's arguments, refused unless there are `min` to `max` of them, the first `min` present. */
function argumentsOf(
    node: CallExpression,
    count: { min: number; max: number },
): { first: Expression; second: Expression | undefined } {
    const args = callArguments(node);
    const name = node.getExpression().getText();
    const [first, second] = args;
    if (first === undefined || args.length < count.min || args.length > count.max) {
        const expected = count.min === count.max ? `${count.min}` : `${count.min} to ${count.max}`;
        throw refuse(node, `${name}() takes ${expected} argument${count.max === 1 ? "" : "s"}, not ${args.length}`);
    }
    return { first, second };
}

function intrinsic(name: string, node: CallExpression, scope: Scope): Value {
    const bare = name.replace(/^\$/, "");
    if (bare === "obj") {
        const { first } = argumentsOf(node, { min: 1, max: 1 });
        const spec = evaluate(first, scope);
        if (spec.kind !== "string") throw refuse(first, `obj() takes a string, not ${describeKind(spec)}`);
        return { kind: "object", spec: spec.value };
    }
    if (bare === "tlkForced") {
        const { first, second } = argumentsOf(node, { min: 2, max: 2 });
        // argumentsOf refuses a tlkForced() call missing its second argument.
        const text = second === undefined ? undefined : evaluate(second, scope);
        if (text?.kind !== "string") {
            throw refuse(node, `tlkForced() takes its text as a string, not ${text ? describeKind(text) : "nothing"}`);
        }
        return strref({ form: "tlkForced", id: strrefId(first, scope), text: text.value });
    }
    // tra(n) / tlk(n), each with an optional { sound }.
    const form = bare === "tra" ? "tra" : "tlk";
    const { first: idExpr, second: optionsExpr } = argumentsOf(node, { min: 1, max: 2 });
    const id = strrefId(idExpr, scope);
    if (optionsExpr === undefined) return strref({ form, id });
    const options = evaluate(optionsExpr, scope);
    if (options.kind !== "record") throw refuse(optionsExpr, `${name}() takes its options as an object`);
    for (const key of options.fields.keys()) {
        if (key !== "sound") throw refuse(optionsExpr, `${name}() has no option '${key}'; it takes { sound }`);
    }
    const sound = options.fields.get("sound");
    if (sound === undefined) return strref({ form, id });
    if (sound.kind !== "string")
        throw refuse(optionsExpr, `a sound is a resource name string, not ${describeKind(sound)}`);
    return strref({ form, id, sound: sound.value });
}

function strref(ref: StrRef): Value {
    return { kind: "strref", ref };
}

function strrefId(expr: Expression, scope: Scope): number {
    const id = evaluate(expr, scope);
    if (id.kind !== "int" || id.value < 0)
        throw refuse(expr, `a string reference is a non-negative integer, not ${describeKind(id)}`);
    return id.value;
}

/** `Math.trunc(a / b)` and its kin compute the exact quotient's rounding, which a bare `/` refuses. */
function math(name: string, node: CallExpression, scope: Scope): Value {
    const rounding: Record<string, (x: number) => number> = { trunc: Math.trunc, floor: Math.floor, ceil: Math.ceil };
    const round = rounding[name];
    if (round !== undefined) {
        const { first: argExpr } = argumentsOf(node, { min: 1, max: 1 });
        const arg = unwrap(argExpr);
        if (Node.isBinaryExpression(arg) && arg.getOperatorToken().getKind() === SyntaxKind.SlashToken) {
            const a = intOperand(evaluate(arg.getLeft(), scope), arg.getLeft());
            const b = intOperand(evaluate(arg.getRight(), scope), arg.getRight());
            if (b === 0) throw refuse(arg, "division by zero");
            // Exact for 32-bit operands: a non-integer quotient sits at least 1/|b| from an integer, far above
            // the rounding error of a double of that size.
            return checkedInt(round(a / b), node);
        }
        return { kind: "int", value: intOperand(evaluate(argExpr, scope), argExpr) };
    }
    if (name === "abs") {
        const { first } = argumentsOf(node, { min: 1, max: 1 });
        return checkedInt(Math.abs(intOperand(evaluate(first, scope), first)), node);
    }
    if (name === "min" || name === "max") {
        const values = callArguments(node).map((arg) => intOperand(evaluate(arg, scope), arg));
        if (values.length === 0) throw refuse(node, `Math.${name}() needs at least one argument`);
        return { kind: "int", value: name === "min" ? Math.min(...values) : Math.max(...values) };
    }
    throw refuse(node, `Math.${name}() is not supported at compile time`);
}

/**
 * Binds a call's arguments to the callee's parameters in a scope of the function's own, and returns that scope
 * with the expression the function returns. The body may declare constants before its one `return`; anything
 * else has no value to stand for the call.
 */
export function bindCall(
    fn: FunctionValue,
    call: CallExpression,
    callerScope: Scope,
): { body: Scope; result: Expression } {
    const body = bindArguments(fn, call, callerScope);
    const statements = fn.declaration.getBody()?.asKind(SyntaxKind.Block)?.getStatements() ?? [];
    const last = statements.at(-1);
    const returned = last !== undefined && Node.isReturnStatement(last) ? last.getExpression() : undefined;
    const leading = statements.slice(0, -1);
    if (returned === undefined || !leading.every((s) => Node.isVariableStatement(s))) {
        throw refuse(
            call,
            `'${fn.name}' is called for its value, so its body must be constants followed by one return of a value`,
        );
    }
    declareStatements(body, leading);
    return { body, result: returned };
}

/** The scope a call to `fn` runs in: its closure, with each parameter bound to its argument's value. */
export function bindArguments(fn: FunctionValue, call: CallExpression, callerScope: Scope): Scope {
    const declaration = fn.declaration;
    const scope = fn.closure.child();
    const params = declaration.getParameters();
    const args = callArguments(call);
    if (args.some((arg) => Node.isSpreadElement(arg))) {
        throw refuse(call, "a spread argument is not supported in a call to a function the source declares");
    }
    if (args.length > params.length) {
        throw refuse(call, `'${declaration.getName()}' takes ${params.length} arguments, not ${args.length}`);
    }
    params.forEach((param, index) => {
        if (param.isRestParameter()) throw refuse(param, "a rest parameter is not supported");
        if (!Node.isIdentifier(param.getNameNode())) throw refuse(param, "a destructured parameter is not supported");
        const arg = args[index];
        if (arg !== undefined) scope.bind(param.getName(), evaluate(arg, callerScope));
        else if (param.getInitializer() !== undefined) scope.declare(param.getName(), param.getInitializer());
        else throw refuse(call, `'${declaration.getName()}' needs an argument for '${param.getName()}'`);
    });
    return scope;
}

/** A condition with every compile-time part folded away: only engine trigger calls remain, or a constant. */
export type Condition =
    | { readonly kind: "constant"; readonly value: boolean }
    | {
          readonly kind: "atom";
          readonly negated: boolean;
          readonly name: string;
          readonly args: readonly Value[];
          /** The source of the call, for the line a diagnostic names; a switch's subject for its case conditions. */
          readonly node: Node;
      }
    | { readonly kind: "and"; readonly items: readonly Condition[] }
    | { readonly kind: "or"; readonly items: readonly Condition[] };

/**
 * `expr` as a condition: engine trigger calls, combined by `&&`, `||` and `!`, with every compile-time part
 * decided now. Negation is pushed down to the calls, so `!` never wraps a group.
 */
export function evaluateCondition(expr: Expression, scope: Scope): Condition {
    const node = unwrap(expr);
    if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.ExclamationToken) {
        return negate(evaluateCondition(node.getOperand(), scope));
    }
    if (Node.isBinaryExpression(node)) {
        const operator = node.getOperatorToken().getKind();
        if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
            const items = [evaluateCondition(node.getLeft(), scope), evaluateCondition(node.getRight(), scope)];
            return operator === SyntaxKind.AmpersandAmpersandToken ? conjunction(items) : disjunction(items);
        }
    }
    if (Node.isCallExpression(node) && Node.isIdentifier(node.getExpression())) {
        const name = node.getExpression().getText();
        if (name === "OR") return orCall(node, scope);
        if (!INTRINSICS.has(name)) {
            const bound = scope.lookup(name, node.getExpression());
            if (bound?.kind === "function") {
                const { body, result } = bindCall(bound, node, scope);
                return evaluateCondition(result, body);
            }
            if (bound === undefined)
                return { kind: "atom", negated: false, name, args: engineArguments(node, scope), node };
        }
    }
    const value = evaluate(node, scope);
    if (value.kind === "bool") return { kind: "constant", value: value.value };
    throw refuse(node, `a condition is an engine trigger call or a compile-time boolean, not ${describeKind(value)}`);
}

/** `OR(n, a, b, ...)`, WeiDU's own spelling of a group, checked against the count it states. */
function orCall(node: CallExpression, scope: Scope): Condition {
    const [countExpr, ...rest] = callArguments(node);
    if (countExpr === undefined) throw refuse(node, "OR() needs a count and the conditions it groups");
    const count = intOperand(evaluate(countExpr, scope), countExpr);
    if (count !== rest.length) {
        throw refuse(node, `OR(${count}, ...) groups ${rest.length} condition${rest.length === 1 ? "" : "s"}`);
    }
    return disjunction(rest.map((item) => evaluateCondition(item, scope)));
}

export function negate(condition: Condition): Condition {
    switch (condition.kind) {
        case "constant":
            return { kind: "constant", value: !condition.value };
        case "atom":
            return { ...condition, negated: !condition.negated };
        case "and":
            return disjunction(condition.items.map(negate));
        case "or":
            return conjunction(condition.items.map(negate));
    }
}

/** All of `items`, constants folded away and nested groups flattened. */
export function conjunction(items: readonly Condition[]): Condition {
    const kept: Condition[] = [];
    for (const item of items) {
        if (item.kind === "constant") {
            if (!item.value) return item;
            continue;
        }
        if (item.kind === "and") kept.push(...item.items);
        else kept.push(item);
    }
    const [only] = kept;
    if (only === undefined) return { kind: "constant", value: true };
    return kept.length === 1 ? only : { kind: "and", items: kept };
}

/** Any of `items`, constants folded away and nested groups flattened. */
export function disjunction(items: readonly Condition[]): Condition {
    const kept: Condition[] = [];
    for (const item of items) {
        if (item.kind === "constant") {
            if (item.value) return item;
            continue;
        }
        if (item.kind === "or") kept.push(...item.items);
        else kept.push(item);
    }
    const [only] = kept;
    if (only === undefined) return { kind: "constant", value: false };
    return kept.length === 1 ? only : { kind: "or", items: kept };
}

/** Runs `onIteration` once per pass of a compile-time `for` loop, each pass in a scope holding the counter. */
export function unrollFor(loop: ForStatement, scope: Scope, onIteration: (iteration: Scope) => void): void {
    const initializer = loop.getInitializer();
    const declarations =
        initializer !== undefined && Node.isVariableDeclarationList(initializer) ? initializer.getDeclarations() : [];
    const [declaration] = declarations;
    if (declarations.length !== 1 || declaration === undefined || !Node.isIdentifier(declaration.getNameNode())) {
        throw refuse(loop, "a compile-time for loop declares one counter: for (let i = ...; ...; ...)");
    }
    const counter = declaration.getName();
    const start = declaration.getInitializer();
    if (start === undefined) throw refuse(declaration, `the counter '${counter}' needs a starting value`);
    const condition = loop.getCondition();
    if (condition === undefined) throw refuse(loop, "a compile-time for loop needs a condition");
    const incrementor = loop.getIncrementor();
    if (incrementor === undefined) throw refuse(loop, "a compile-time for loop needs an incrementor");

    let current = evaluate(start, scope);
    for (let pass = 0; ; pass++) {
        const iteration = scope.child();
        iteration.bind(counter, current);
        const proceed = evaluate(condition, iteration);
        if (proceed.kind !== "bool")
            throw refuse(condition, `a loop condition is a compile-time boolean, not ${describeKind(proceed)}`);
        if (!proceed.value) return;
        if (pass >= MAX_LOOP_ITERATIONS) {
            throw refuse(loop, `the loop runs past ${MAX_LOOP_ITERATIONS} passes, the most a compile-time loop may`);
        }
        onIteration(iteration);
        current = step(incrementor, counter, iteration);
    }
}

/** The counter's next value: `i++`, `i--`, `i += n`, `i -= n` or `i = expr`, each read in the pass's scope. */
function step(incrementor: Expression, counter: string, scope: Scope): Value {
    const node = unwrap(incrementor);
    const target =
        Node.isPrefixUnaryExpression(node) || Node.isPostfixUnaryExpression(node)
            ? node.getOperand()
            : Node.isBinaryExpression(node)
              ? node.getLeft()
              : undefined;
    if (target === undefined || target.getText() !== counter) {
        throw refuse(node, `a compile-time for loop's incrementor updates its counter '${counter}'`);
    }
    const current = intOperand(evaluateIdentifier(counter, scope, node), node);
    if (Node.isPrefixUnaryExpression(node) || Node.isPostfixUnaryExpression(node)) {
        const operator = node.getOperatorToken();
        if (operator === SyntaxKind.PlusPlusToken) return checkedInt(current + 1, node);
        if (operator === SyntaxKind.MinusMinusToken) return checkedInt(current - 1, node);
    } else if (Node.isBinaryExpression(node)) {
        const operator = node.getOperatorToken().getKind();
        if (operator === SyntaxKind.EqualsToken) return evaluate(node.getRight(), scope);
        const amount = intOperand(evaluate(node.getRight(), scope), node.getRight());
        if (operator === SyntaxKind.PlusEqualsToken) return checkedInt(current + amount, node);
        if (operator === SyntaxKind.MinusEqualsToken) return checkedInt(current - amount, node);
    }
    throw refuse(node, "a compile-time for loop steps its counter with ++, --, +=, -= or =");
}

/** Runs `onIteration` once per element of a compile-time array, binding the loop variable or its destructuring. */
export function unrollForOf(loop: ForOfStatement, scope: Scope, onIteration: (iteration: Scope) => void): void {
    const initializer = loop.getInitializer();
    const declarations = Node.isVariableDeclarationList(initializer) ? initializer.getDeclarations() : [];
    const [declaration] = declarations;
    if (declarations.length !== 1 || declaration === undefined) {
        throw refuse(loop, "a compile-time for...of loop declares one variable: for (const x of ...)");
    }
    const iterable = evaluate(loop.getExpression(), scope);
    if (iterable.kind !== "array")
        throw refuse(loop.getExpression(), `for...of runs over an array, not ${describeKind(iterable)}`);
    const nameNode = declaration.getNameNode();
    for (const item of iterable.items) {
        const iteration = scope.child();
        if (Node.isIdentifier(nameNode)) {
            iteration.bind(nameNode.getText(), item);
        } else if (Node.isArrayBindingPattern(nameNode)) {
            if (item.kind !== "array")
                throw refuse(nameNode, `${describeKind(item)} cannot be destructured as an array`);
            nameNode.getElements().forEach((bound, index) => {
                if (Node.isOmittedExpression(bound)) return;
                if (bound.getDotDotDotToken() !== undefined || !Node.isIdentifier(bound.getNameNode())) {
                    throw refuse(bound, "only plain names destructure in a for...of loop");
                }
                const value = item.items[index];
                if (value === undefined)
                    throw refuse(bound, `the element has no item ${index} for '${bound.getName()}'`);
                iteration.bind(bound.getName(), value);
            });
        } else {
            throw refuse(nameNode, "only an array pattern destructures in a for...of loop");
        }
        onIteration(iteration);
    }
}
