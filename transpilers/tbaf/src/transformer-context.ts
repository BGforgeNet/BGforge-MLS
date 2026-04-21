/**
 * Shared context interface for TBAF transformer modules.
 *
 * Extracted functions in condition-algebra.ts and loop-unroll.ts
 * receive this interface instead of the full TBAFTransformer class,
 * keeping the modules loosely coupled.
 */

import { CallExpression, Expression, FunctionDeclaration, Statement } from "ts-morph";
import type { BAFAction, BAFCondition } from "./ir";
import type { VarsContext } from "../../common/transpiler-utils";

/** Context for function inlining */
export type FuncsContext = Map<string, FunctionDeclaration>;

/**
 * Interface exposing the transformer state and utility methods
 * needed by the extracted condition-algebra and loop-unroll modules.
 */
export interface TransformerContext {
    readonly vars: VarsContext;
    readonly funcs: FuncsContext;

    /** Transform a call expression to a BAFCondition (for built-in BAF conditions). */
    transformCallToCondition(call: CallExpression): BAFCondition;

    /** Transform statements to BAFActions. */
    transformActionsFromStatements(statements: Statement[]): BAFAction[];

    /** Create an opaque condition (for expressions we can't parse). */
    opaqueCondition(text: string, negated: boolean): BAFCondition;

    /** Create a True() condition placeholder. */
    trueCondition(): BAFCondition;

    /** Parse a TypeScript expression from a string of code. */
    parseExpressionFromText(text: string): Expression | undefined;

    /** Resolve a variable identifier to its underlying expression. */
    resolveVariableToExpression(expr: Expression): Expression;

    /** Resolve array elements from an expression. */
    resolveArrayElements(expr: Expression): string[] | null;
}
