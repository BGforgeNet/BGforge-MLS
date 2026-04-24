/**
 * TD expression evaluation - converts TypeScript expressions to
 * WeiDU D triggers, actions, and text values.
 *
 * Extracted from TDParser as standalone functions that receive
 * the vars context as a parameter.
 */

import { Expression, Node, SyntaxKind } from "ts-morph";
import { TDTextType, type TDText } from "./types";
import * as utils from "../../common/transpiler-utils";
import type { VarsContext } from "../../common/transpiler-utils";
import { expressionToActionString, parseStringOption } from "./parse-helpers";

/** TD function/keyword constants for text types */
const TEXT_KEYWORDS = {
    TRA: "tra",
    TLK: "tlk",
    TLK_FORCED: "tlkForced",
} as const;

/**
 * Convert an expression to a trigger string.
 */
function expressionToTrigger(expr: Expression, vars: VarsContext): string {
    // Handle binary expressions (||, &&)
    if (Node.isBinaryExpression(expr)) {
        const opKind = expr.getOperatorToken().getKind();

        if (opKind === SyntaxKind.AmpersandAmpersandToken) {
            // AND: space-separated conditions
            const left = expressionToTrigger(expr.getLeft(), vars);
            const right = expressionToTrigger(expr.getRight(), vars);
            return `${left} ${right}`;
        }

        if (opKind === SyntaxKind.BarBarToken) {
            // OR: collect all OR-ed conditions and emit as OR(n) cond1 cond2 ...
            const conditions = collectOrConditions(expr, vars);
            const count = conditions.length;
            return `OR(${count}) ${conditions.join(" ")}`;
        }
    }

    // Handle parenthesized expression
    if (Node.isParenthesizedExpression(expr)) {
        return expressionToTrigger(expr.getExpression(), vars);
    }

    // Handle OR(n, cond1, cond2, ...) -> OR(n) cond1 cond2 ...
    if (Node.isCallExpression(expr)) {
        const funcName = expr.getExpression().getText();
        if (funcName === "OR" && expr.getArguments().length >= 2) {
            const args = expr.getArguments();
            const count = args[0]?.getText() ?? "2";
            const conditions = args.slice(1).map((a) => expressionToTrigger(a as Expression, vars));
            return `OR(${count}) ${conditions.join(" ")}`;
        }
        // Regular function call - serialize as trigger
        return expressionToActionString(expr, vars);
    }

    // Handle ! prefix
    if (Node.isPrefixUnaryExpression(expr) && expr.getOperatorToken() === SyntaxKind.ExclamationToken) {
        const inner = expressionToTrigger(expr.getOperand(), vars);
        return `!${inner}`;
    }

    return utils.substituteVars(expr.getText(), vars);
}

/**
 * Collect all conditions from a || chain into a flat array.
 */
function collectOrConditions(expr: Expression, vars: VarsContext): string[] {
    const conditions: string[] = [];

    const collect = (e: Expression) => {
        if (Node.isBinaryExpression(e) && e.getOperatorToken().getKind() === SyntaxKind.BarBarToken) {
            collect(e.getLeft());
            collect(e.getRight());
        } else if (Node.isParenthesizedExpression(e)) {
            collect(e.getExpression());
        } else {
            // Atom - could be a call, negated call, or other expression
            conditions.push(expressionToTrigger(e, vars));
        }
    };

    collect(expr);
    return conditions;
}

/**
 * Convert an expression to an action string.
 */
function expressionToAction(expr: Expression, vars: VarsContext): string {
    return expressionToActionString(expr, vars);
}

/**
 * Convert an expression to TDText.
 */
function expressionToText(expr: Expression, vars: VarsContext): TDText {
    // Handle object literal for male/female variants
    if (Node.isObjectLiteralExpression(expr)) {
        let male: TDText | undefined;
        let female: TDText | undefined;
        let maleSound: string | undefined;
        let femaleSound: string | undefined;

        for (const prop of expr.getProperties()) {
            if (Node.isPropertyAssignment(prop)) {
                const propName = prop.getName();
                const value = prop.getInitializer();
                if (!value) continue;

                if (propName === "male") {
                    male = expressionToText(value, vars);
                } else if (propName === "female") {
                    female = expressionToText(value, vars);
                } else if (propName === "maleSound") {
                    maleSound = utils.stripQuotes(value.getText());
                } else if (propName === "femaleSound") {
                    femaleSound = utils.stripQuotes(value.getText());
                }
            }
        }

        if (male && female) {
            if (maleSound) male.sound = maleSound;
            if (femaleSound) female.sound = femaleSound;
            return {
                type: TDTextType.Tra, // Placeholder, actual type from male/female
                value: 0,
                male,
                female,
            };
        }
    }

    if (Node.isCallExpression(expr)) {
        const funcName = expr.getExpression().getText();
        const args = expr.getArguments();

        // tra(num) or $tra(num) or tra(num, { sound: "..." })
        if ((funcName === TEXT_KEYWORDS.TRA || funcName === "$tra") && args.length >= 1 && args[0]) {
            const argText = utils.substituteVars(args[0].getText(), vars);
            const text: TDText = {
                type: TDTextType.Tra,
                value: Number(argText),
                sound: parseStringOption(args[1], "sound"),
            };
            return text;
        }

        // tlk(num) or $tlk(num) or tlk(num, { sound: "..." })
        if ((funcName === TEXT_KEYWORDS.TLK || funcName === "$tlk") && args.length >= 1 && args[0]) {
            const argText = utils.substituteVars(args[0].getText(), vars);
            const text: TDText = {
                type: TDTextType.Tlk,
                value: Number(argText),
                sound: parseStringOption(args[1], "sound"),
            };
            return text;
        }

        // tlkForced(num, text) - text override is stored in emitter, not IR
        if (funcName === TEXT_KEYWORDS.TLK_FORCED && args.length >= 2 && args[0] && args[1]) {
            const numText = utils.substituteVars(args[0].getText(), vars);
            return {
                type: TDTextType.Forced,
                value: numText,
            };
        }
    }

    if (Node.isStringLiteral(expr) || expr.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
        return {
            type: TDTextType.Literal,
            value: utils.resolveStringLiteral(expr),
        };
    }

    // Fallback to literal
    return {
        type: TDTextType.Literal,
        value: utils.substituteVars(expr.getText(), vars),
    };
}

export { expressionToTrigger, expressionToAction, expressionToText };
