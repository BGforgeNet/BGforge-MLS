/**
 * Operator conversion for TSSL transpiler.
 * Converts TypeScript operators and expressions to SSL syntax using the AST.
 */

import { Node } from "ts-morph";
import { SyntaxKind, FORBIDDEN_GLOBALS, RESERVED_VAR_NAMES, type TsslContext } from "./types";
import { TranspileError } from "../../common/transpile-error";

/**
 * Converts operators from TypeScript to SSL syntax using the AST
 * @param node The expression node containing operators to convert
 * @param ctx Optional transpilation context (not available during early extraction phases)
 * @returns The expression with converted operators
 */
export function convertOperatorsAST(node: Node, ctx?: TsslContext): string {
    // Different handling based on node kind
    switch (node.getKind()) {
        case SyntaxKind.BinaryExpression: {
            const binary = node.asKindOrThrow(SyntaxKind.BinaryExpression);
            const operator = binary.getOperatorToken().getText();

            // Handle comma expression (0, expr) - just return the right side
            if (operator === ",") {
                return convertOperatorsAST(binary.getRight(), ctx);
            }

            const left = convertOperatorsAST(binary.getLeft(), ctx);
            const right = convertOperatorsAST(binary.getRight(), ctx);

            // Convert operator
            let sslOperator = operator;
            switch (operator) {
                case "&&":
                    sslOperator = "and";
                    break;
                case "||":
                    sslOperator = "or";
                    break;
                case "&":
                    sslOperator = "bwand";
                    break;
                case "|":
                    sslOperator = "bwor";
                    break;
                case "^":
                    sslOperator = "bxor";
                    break;
            }

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
                return `bnot ${operand}`;
            }

            // Other unary operators (++x, --x, -x, +x) remain as-is
            return prefix.getText();
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
                            const expr = computed.getExpression();
                            return `${expr.getText()}: ${initializer}`;
                        }
                        // String literal key - already quoted, use as-is
                        if (nameNode.getKind() === SyntaxKind.StringLiteral) {
                            return `${nameNode.getText()}: ${initializer}`;
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

        // Handle property access - strip folib_exports. prefix
        case SyntaxKind.PropertyAccessExpression: {
            const propAccess = node.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
            const obj = propAccess.getExpression().getText();
            const prop = propAccess.getName();

            // Check for forbidden globals
            if (FORBIDDEN_GLOBALS.has(obj)) {
                throw TranspileError.fromNode(node, `${obj}.${prop} is not available in SSL runtime`);
            }

            // Strip folib_exports. or similar _exports. prefixes
            if (obj.endsWith("_exports")) {
                return prop;
            }
            return `${convertOperatorsAST(propAccess.getExpression(), ctx)}.${prop}`;
        }

        // Handle element access (array indexing) - need to process the index expression
        case SyntaxKind.ElementAccessExpression: {
            const elemAccess = node.asKindOrThrow(SyntaxKind.ElementAccessExpression);
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

        case SyntaxKind.NumericLiteral: {
            const text = node.getText();
            // Preserve float literals - if it has a decimal point, keep it
            // If it's an integer but was originally written as X.0, esbuild strips the .0
            // We can't recover that, but we can ensure numbers with decimals stay as floats
            if (text.includes(".")) {
                return text;
            }
            // For integers, just return as-is
            return text;
        }

        case SyntaxKind.Identifier: {
            const text = node.getText();
            // FLOAT1 is a special constant that forces float division
            // esbuild strips .0 from float literals, so we use FLOAT1 * a / b
            // to ensure float division in SSL output
            if (text === "FLOAT1") return "1.0";
            return text;
        }

        default:
            // If no operators to convert, return the original text
            return node.getText();
    }
}

/**
 * Converts a let or const VariableStatement node to a 'variable' statement, preserving formatting.
 *
 * @param stmt The ts-morph Node representing the VariableStatement.
 * @param ctx Transpilation context
 * @returns The converted 'variable' statement as a string.
 * @throws Error if the statement is not a let/const variable declaration.
 */
export function convertVarOrConstToVariable(stmt: Node, ctx: TsslContext): string {
    const varStmt = stmt.asKind(SyntaxKind.VariableStatement);
    if (!varStmt) throw TranspileError.fromNode(stmt, "Statement is not a VariableStatement");

    const declList = varStmt.getDeclarationList();
    const keywordNode = declList.getFirstChild();
    const keywordKind = keywordNode ? keywordNode.getKind() : undefined;

    if (keywordKind !== SyntaxKind.LetKeyword && keywordKind !== SyntaxKind.ConstKeyword) {
        throw TranspileError.fromNode(stmt, "VariableStatement is not a let/const declaration");
    }

    // Use AST positions to do precise substitution
    let originalText = stmt.getText();
    const stmtStart = stmt.getStart();

    // Collect all replacements with their positions, then apply from end to start
    // to avoid position shifts
    const replacements: { start: number; end: number; text: string }[] = [];

    for (const decl of declList.getDeclarations()) {
        const varName = decl.getName();
        if (RESERVED_VAR_NAMES.has(varName)) {
            throw TranspileError.fromNode(
                decl,
                `Variable name '${varName}' conflicts with folib export. Use a different name.`,
            );
        }
        const initializer = decl.getInitializer();
        if (initializer) {
            const converted = convertOperatorsAST(initializer, ctx);
            if (converted !== initializer.getText()) {
                replacements.push({
                    start: initializer.getStart() - stmtStart,
                    end: initializer.getEnd() - stmtStart,
                    text: converted,
                });
            }
        }
    }

    // Apply replacements from end to start
    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
        originalText = originalText.substring(0, r.start) + r.text + originalText.substring(r.end);
    }

    // Get the position of the keyword in the source file
    // keywordNode is guaranteed non-null: we checked keywordKind above
    const keywordPos = keywordNode!.getStart();
    const keywordEnd = keywordNode!.getEnd();
    const keywordRelativePos = keywordPos - stmt.getStart(); // Position within the statement text

    // Replace only the keyword exactly
    const beforeKeyword = originalText.substring(0, keywordRelativePos);
    const afterKeyword = originalText.substring(keywordRelativePos + (keywordEnd - keywordPos));
    let result = beforeKeyword + "variable" + afterKeyword;

    // Add semicolon at the end if needed (only if it doesn't already end with one)
    if (!result.trim().endsWith(";")) {
        const lastNonWhitespacePos = result.trimEnd().length;
        result = result.substring(0, lastNonWhitespacePos) + ";" + result.substring(lastNonWhitespacePos);
    }

    return result;
}
