/**
 * Operator conversion for TSSL transpiler.
 * Converts TypeScript operators and expressions to SSL syntax using the AST.
 *
 * The input is raw TypeScript, so TYPE syntax is erased here: `as`/`satisfies` casts and non-null
 * assertions unwrap to their expression, and rebuilt forms (calls, unaries, declarations) never copy a
 * source span that could carry an annotation. The bundler used to do this erasure; without it, the one
 * place type syntax could still leak into output is a raw `getText()`, so the default arm refuses what
 * it does not recognise instead of passing it through.
 */

import type { Node } from "ts-morph";
import { SyntaxKind, FORBIDDEN_GLOBALS, RESERVED_VAR_NAMES, sslName, type TsslContext } from "./types";
import { refuseAt } from "./program-model";

/**
 * TypeScript binary operators and the SSL they render as. An allowlist rather than a fix-up switch: the
 * old form passed anything it did not recognise straight through, so `a instanceof b` reached the output
 * verbatim and failed in the generated file, where the error named a line nobody wrote.
 *
 * Assignment forms are here because an assignment arrives as a binary expression too. SSL's own set is
 * wider than this - `in`, `div`, `orelse`, `andalso` have no TypeScript spelling to map from.
 */
const BINARY_OPERATORS = new Map<string, string>([
    ["+", "+"],
    ["-", "-"],
    ["*", "*"],
    ["/", "/"],
    ["%", "%"],
    ["==", "=="],
    ["===", "=="],
    ["!=", "!="],
    ["!==", "!="],
    ["<", "<"],
    ["<=", "<="],
    [">", ">"],
    [">=", ">="],
    ["&&", "and"],
    ["||", "or"],
    ["&", "bwand"],
    ["|", "bwor"],
    // `bwxor`, not `bxor` - the latter is not an SSL token and the compiler rejects it.
    ["^", "bwxor"],
    ["=", "="],
    ["+=", "+="],
    ["-=", "-="],
    ["*=", "*="],
    ["/=", "/="],
]);

/** Syntax with no SSL counterpart: passing it through would emit text SSL cannot compile. */
const REFUSED_EXPRESSIONS = new Map<SyntaxKind, string>([
    [SyntaxKind.TemplateExpression, "template literals are not supported; concatenate with +"],
    [SyntaxKind.TaggedTemplateExpression, "template literals are not supported; concatenate with +"],
    [SyntaxKind.ArrowFunction, "arrow functions are not supported; declare a function"],
    [SyntaxKind.FunctionExpression, "function expressions are not supported; declare a function"],
    [SyntaxKind.SpreadElement, "spread is not supported"],
    [SyntaxKind.AwaitExpression, "await is not supported"],
    [SyntaxKind.YieldExpression, "yield is not supported"],
    [SyntaxKind.NewExpression, "'new' is not supported; SSL has no objects"],
    [SyntaxKind.ClassExpression, "classes are not supported"],
    [SyntaxKind.RegularExpressionLiteral, "regular expressions are not supported"],
    // SSL has a `typeof` too, so copying this one through produced a program that compiled and meant
    // something else - the engine operator yields a value type where TypeScript yields a type name.
    [SyntaxKind.TypeOfExpression, "'typeof' is not supported; call sfall_typeof(x) for the engine's value type"],
]);

/**
 * Converts operators from TypeScript to SSL syntax using the AST
 * @param node The expression node containing operators to convert
 * @param ctx Optional transpilation context (not available during early extraction phases)
 * @returns The expression with converted operators
 */
export function convertOperatorsAST(node: Node, ctx?: TsslContext): string {
    const refusal = REFUSED_EXPRESSIONS.get(node.getKind());
    if (refusal !== undefined) throw refuseAt(node, refusal);

    // Different handling based on node kind
    switch (node.getKind()) {
        case SyntaxKind.BinaryExpression: {
            const binary = node.asKindOrThrow(SyntaxKind.BinaryExpression);
            const operator = binary.getOperatorToken().getText();

            // Handle comma expression (0, expr) - just return the right side
            if (operator === ",") {
                return convertOperatorsAST(binary.getRight(), ctx);
            }
            if (operator === "**") {
                throw refuseAt(node, "'**' is not supported; SSL spells exponentiation '^'");
            }
            if (operator === "??") {
                throw refuseAt(node, "'??' is not supported; SSL has no null");
            }

            const sslOperator = BINARY_OPERATORS.get(operator);
            if (sslOperator === undefined) {
                throw refuseAt(node, `'${operator}' has no SSL equivalent`);
            }

            const left = convertOperatorsAST(binary.getLeft(), ctx);
            const right = convertOperatorsAST(binary.getRight(), ctx);
            return `${left} ${sslOperator} ${right}`;
        }

        case SyntaxKind.PrefixUnaryExpression: {
            const prefix = node.asKindOrThrow(SyntaxKind.PrefixUnaryExpression);
            const operand = convertOperatorsAST(prefix.getOperand(), ctx);
            const operator = prefix.getOperatorToken();

            // Convert unary operator
            if (operator === SyntaxKind.ExclamationToken) {
                return `not ${operand}`;
            } else if (operator === SyntaxKind.TildeToken) {
                // `bwnot`, not `bnot` - the latter is not an SSL token.
                return `bwnot ${operand}`;
            }
            // Rebuilt from the converted operand rather than copied, so a cast inside stays erased.
            if (operator === SyntaxKind.MinusToken) return `-${operand}`;
            if (operator === SyntaxKind.PlusToken) return `+${operand}`;
            if (operator === SyntaxKind.PlusPlusToken) return `++${operand}`;
            return `--${operand}`;
        }

        case SyntaxKind.PostfixUnaryExpression: {
            const postfix = node.asKindOrThrow(SyntaxKind.PostfixUnaryExpression);
            const operand = convertOperatorsAST(postfix.getOperand(), ctx);
            const operator = postfix.getOperatorToken();

            // i++ and i-- work the same in SSL (only two valid postfix operators)
            if (operator === SyntaxKind.PlusPlusToken) {
                return `${operand}++`;
            }
            // operator === SyntaxKind.MinusMinusToken
            return `${operand}--`;
        }

        case SyntaxKind.ParenthesizedExpression: {
            const parens = node.asKindOrThrow(SyntaxKind.ParenthesizedExpression);
            const expression = convertOperatorsAST(parens.getExpression(), ctx);
            return `(${expression})`;
        }

        // Type-level wrappers: the cast exists for the checker and erases from the output.
        case SyntaxKind.AsExpression:
            return convertOperatorsAST(node.asKindOrThrow(SyntaxKind.AsExpression).getExpression(), ctx);
        case SyntaxKind.SatisfiesExpression:
            return convertOperatorsAST(node.asKindOrThrow(SyntaxKind.SatisfiesExpression).getExpression(), ctx);
        case SyntaxKind.NonNullExpression:
            return convertOperatorsAST(node.asKindOrThrow(SyntaxKind.NonNullExpression).getExpression(), ctx);
        case SyntaxKind.TypeAssertionExpression:
            return convertOperatorsAST(node.asKindOrThrow(SyntaxKind.TypeAssertionExpression).getExpression(), ctx);

        // Handle array literals
        case SyntaxKind.ArrayLiteralExpression: {
            const array = node.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
            const elements = array
                .getElements()
                .map((element) => convertOperatorsAST(element, ctx))
                .join(", ");
            return `[${elements}]`;
        }

        // Handle object literals
        case SyntaxKind.ObjectLiteralExpression: {
            const obj = node.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
            const properties = obj
                .getProperties()
                .map((prop) => {
                    if (prop.getKind() === SyntaxKind.PropertyAssignment) {
                        const propAssignment = prop.asKindOrThrow(SyntaxKind.PropertyAssignment);
                        const nameNode = propAssignment.getNameNode();
                        const initNode = propAssignment.getInitializer();
                        const initializer = initNode ? convertOperatorsAST(initNode, ctx) : "";
                        // Handle computed property names: [PID_MINIGUN] -> PID_MINIGUN
                        if (nameNode.getKind() === SyntaxKind.ComputedPropertyName) {
                            const computed = nameNode.asKindOrThrow(SyntaxKind.ComputedPropertyName);
                            return `${convertOperatorsAST(computed.getExpression(), ctx)}: ${initializer}`;
                        }
                        // String literal key - normalised like any other string
                        if (nameNode.getKind() === SyntaxKind.StringLiteral) {
                            return `${convertOperatorsAST(nameNode, ctx)}: ${initializer}`;
                        }
                        // Numeric literal key - no quotes needed
                        if (nameNode.getKind() === SyntaxKind.NumericLiteral) {
                            return `${nameNode.getText()}: ${initializer}`;
                        }
                        // Identifier key - add quotes
                        return `"${propAssignment.getName()}": ${initializer}`;
                    }
                    return prop.getText();
                })
                .join(", ");
            return `{${properties}}`;
        }

        // Handle conditional expressions (ternary)
        case SyntaxKind.ConditionalExpression: {
            const conditional = node.asKindOrThrow(SyntaxKind.ConditionalExpression);
            const condition = convertOperatorsAST(conditional.getCondition(), ctx);
            const whenTrue = convertOperatorsAST(conditional.getWhenTrue(), ctx);
            const whenFalse = convertOperatorsAST(conditional.getWhenFalse(), ctx);
            return `(${condition}) ? ${whenTrue} : ${whenFalse}`;
        }

        case SyntaxKind.PropertyAccessExpression: {
            const propAccess = node.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
            if (propAccess.hasQuestionDotToken()) {
                throw refuseAt(node, "'?.' is not supported; SSL has no null");
            }
            const raw = propAccess.getExpression().getText();
            const prop = propAccess.getName();

            // Check for forbidden globals
            if (FORBIDDEN_GLOBALS.has(raw)) {
                throw refuseAt(node, `${raw}.${prop} is not available in SSL runtime`);
            }

            // An enum member access prints as the name its define carries: the flat EnumName_Member for
            // an enum declared in project code, the bare member for a declare-enum whose values the SSL
            // headers already #define. An imported alias of an enum resolves through the rename first.
            const obj = ctx?.importRenames.get(raw) ?? raw;
            if (ctx?.localEnumNames.has(obj)) return `${obj}_${prop}`;
            if (ctx?.externEnumNames.has(obj)) return prop;

            return `${convertOperatorsAST(propAccess.getExpression(), ctx)}.${prop}`;
        }

        // Handle element access (array indexing) - need to process the index expression
        case SyntaxKind.ElementAccessExpression: {
            const elemAccess = node.asKindOrThrow(SyntaxKind.ElementAccessExpression);
            if (elemAccess.hasQuestionDotToken()) {
                throw refuseAt(node, "'?.' is not supported; SSL has no null");
            }
            const obj = convertOperatorsAST(elemAccess.getExpression(), ctx);
            const arg = elemAccess.getArgumentExpression();
            const index = arg ? convertOperatorsAST(arg, ctx) : "";
            return `${obj}[${index}]`;
        }

        // Handle call expressions which might contain operators in arguments
        case SyntaxKind.CallExpression: {
            const call = node.asKindOrThrow(SyntaxKind.CallExpression);
            const callExpr = call.getExpression();
            const fnName = convertOperatorsAST(callExpr, ctx);

            // Special handling for list() and map() - convert to SSL array/map literals
            if (fnName === "list") {
                const args = call.getArguments().map((arg) => convertOperatorsAST(arg, ctx));
                return `[${args.join(", ")}]`;
            }
            if (fnName === "map") {
                const mapArgs = call.getArguments();
                if (mapArgs.length === 0) {
                    return "{}";
                }
                // map() takes a single object argument, just output it directly
                const mapArg0 = mapArgs[0];
                if (mapArgs.length === 1 && mapArg0) {
                    return convertOperatorsAST(mapArg0, ctx);
                }
            }

            const args = call.getArguments().map((arg) => convertOperatorsAST(arg, ctx));

            // For zero-arg inline macros, don't use parentheses (only if ctx available)
            if (ctx) {
                const inlineFunc = ctx.inlineFunctions.get(fnName);
                if (args.length === 0 && inlineFunc?.params.length === 0) {
                    return fnName;
                }

                // In SSL, external functions (declarations) with no args don't use parentheses
                if (args.length === 0 && !ctx.definedFunctions.has(fnName)) {
                    return fnName;
                }
            }

            return `${fnName}(${args.join(", ")})`;
        }

        case SyntaxKind.StringLiteral: {
            // SSL strings are double-quoted; a single-quoted literal is re-quoted with the same value.
            const text = node.getText();
            if (text.startsWith('"')) return text;
            const value = node.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
            return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n").replaceAll("\t", "\\t").replaceAll("\r", "\\r")}"`;
        }

        case SyntaxKind.NumericLiteral: {
            // Read from the source text, so `100.0` stays the float the author wrote - the old pipeline
            // let the bundler normalise it to `100`, silently turning float division into integer.
            return node.getText();
        }

        case SyntaxKind.Identifier: {
            const text = node.getText();
            // FLOAT1 predates float-literal preservation: sources written against the old pipeline
            // spell 1.0 this way, so it keeps meaning exactly that.
            if (text === "FLOAT1") return "1.0";
            // The output holds declaration names only, so an imported alias renders as what it names.
            return sslName(ctx?.importRenames.get(text) ?? text);
        }

        // SSL spells the booleans the same way, but they are rendered rather than copied so that
        // nothing reaches the refusal below by accident.
        case SyntaxKind.TrueKeyword:
            return "true";
        case SyntaxKind.FalseKeyword:
            return "false";

        default:
            throw refuseAt(node, `${node.getKindName()} is not supported`);
    }
}

/**
 * Converts a let or const VariableStatement node to a 'variable' statement.
 *
 * Rebuilt from the declarations rather than patched over the source text: the raw text carries type
 * annotations (`let x: number;`) that SSL cannot hold, and rebuilding is what erases them.
 */
export function convertVarOrConstToVariable(stmt: Node, ctx: TsslContext): string {
    const varStmt = stmt.asKind(SyntaxKind.VariableStatement);
    if (!varStmt) throw refuseAt(stmt, "Statement is not a VariableStatement");

    const declList = varStmt.getDeclarationList();
    const keyword = declList.getFirstChild()?.getKind();
    if (keyword !== SyntaxKind.LetKeyword && keyword !== SyntaxKind.ConstKeyword) {
        throw refuseAt(stmt, "VariableStatement is not a let/const declaration");
    }

    const parts = declList.getDeclarations().map((decl) => {
        // `getName()` on a binding pattern returns the pattern text, which used to be emitted as though
        // it were an identifier. SSL declares one name at a time; the two-element form a `foreach` takes
        // is a different construct, handled where that loop is rendered.
        if (decl.getNameNode().getKind() !== SyntaxKind.Identifier) {
            throw refuseAt(decl, "destructuring is not supported; declare each variable separately");
        }
        const varName = decl.getName();
        if (RESERVED_VAR_NAMES.has(varName)) {
            throw refuseAt(decl, `Variable name '${varName}' conflicts with folib export. Use a different name.`);
        }
        const initializer = decl.getInitializer();
        return initializer ? `${varName} = ${convertOperatorsAST(initializer, ctx)}` : varName;
    });
    return `variable ${parts.join(", ")};`;
}
