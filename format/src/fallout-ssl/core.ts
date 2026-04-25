/**
 * Core formatting logic for Fallout SSL files.
 * Shared between LSP server and CLI.
 *
 * Control flow formatters are in control-flow.ts.
 * Expression formatters are in expressions.ts.
 *
 * For formatter behavior and examples, see:
 * {@link https://github.com/bgforge/vscode-mls/tree/master/grammars/fallout-ssl/formatter.md}
 */

import type { Node as SyntaxNode } from "web-tree-sitter";

import { formatIfStmt, formatWhileStmt, formatForStmt, formatForeachStmt, formatSwitchStmt } from "./control-flow";
import { formatExpression, formatCallStmt, formatAssignment, formatExpressionStmt } from "./expressions";
import { SyntaxType } from "../../../server/src/fallout-ssl/tree-sitter.d";

import { throwOnParseError } from "@bgforge/format";

interface FormatOptions {
    indentSize: number;
    lineLimit: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
    indentSize: 4,
    lineLimit: 120,
};

// Format context passed through all functions
interface FormatContext {
    indent: string;
    lineLimit: number;
}

let ctx: FormatContext = {
    indent: "    ",
    lineLimit: 120,
};

/** Get the current format context. Used by extracted formatter modules. */
export function getCtx(): FormatContext {
    return ctx;
}

// Regex patterns for keyword matching
const BEGIN_END_REGEX = /^(begin|end)$/i;
const BEGIN_END_PROCEDURE_REGEX = /^(begin|end|procedure)$/i;

/** Abort formatting with a descriptive error including source location. */
export function throwFormatError(message: string, line: number, column: number): never {
    throw new Error(`${line}:${column}: ${message}`);
}

// Helper: check if node is a comment
export function isComment(node: SyntaxNode): boolean {
    return node.type === SyntaxType.Comment || node.type === SyntaxType.LineComment;
}

// Helper: check if next sibling is a trailing comment on same line
function hasTrailingComment(child: SyntaxNode, nextChild: SyntaxNode | undefined): boolean {
    return nextChild !== undefined && isComment(nextChild) && nextChild.startPosition.row === contentEndRow(child);
}

// Get the row where a node's actual content ends.
// #define nodes include the trailing \n in their span, so endPosition.row
// is 1 past the content line. This adjusts for that to enable correct blank line detection.
function contentEndRow(node: SyntaxNode): number {
    return node.text.endsWith("\n") ? node.endPosition.row - 1 : node.endPosition.row;
}

// Normalize preprocessor directives with trailing comments.
//
// The natural form `text.match(/^(.+?)(\s*)(\/\/[^\r\n]*)[\r\n]*$/)` is
// polynomial: lazy `(.+?)` and greedy `(\s*)` overlap (whitespace can belong
// to either capture), so the engine retries every split point on input that
// looks code-like but lacks the trailing comment. The block-comment variant
// has the same shape. The formatter is library-exposed via `@bgforge/format`,
// so input is treated as untrusted and we use indexed scans here (CodeQL
// js/polynomial-redos).
function normalizePreprocessor(text: string): string {
    // Identify the trailing `[\r\n]*` tail, then search the body for a comment.
    // The comment branches return `code + indent + comment`, with no tail —
    // matching the original regexes' `[\r\n]*$` consumption.
    let tailStart = text.length;
    while (tailStart > 0) {
        const c = text.charCodeAt(tailStart - 1);
        if (c !== 10 && c !== 13) break;
        tailStart--;
    }
    const body = text.slice(0, tailStart);

    // Trailing line comment: split at the first "//" with non-empty code
    // before. Preprocessor lines have no string literals, so a literal
    // `indexOf` is safe.
    const slashIdx = body.indexOf("//");
    if (slashIdx > 0) {
        const code = body.slice(0, slashIdx).trimEnd();
        const comment = body.slice(slashIdx);
        if (code && !comment.includes("\n")) {
            return code + ctx.indent + normalizeComment(comment);
        }
    }

    // Trailing block comment, single line only and ending the directive.
    if (body.endsWith("*/")) {
        const openIdx = body.lastIndexOf("/*");
        if (openIdx > 0) {
            const comment = body.slice(openIdx);
            if (!comment.includes("\n")) {
                const code = body.slice(0, openIdx).trimEnd();
                if (code) {
                    return code + ctx.indent + normalizeComment(comment);
                }
            }
        }
    }

    // No comment branch: strip exactly one `\r?\n` at the end, matching the
    // original `text.replace(/\r?\n$/, "")`. Trailing newlines beyond the
    // first are load-bearing — a multiline `#define` whose body ends with
    // `\<newline><blank-line-newline>` relies on that blank-continuation
    // newline to terminate the macro on the next reparse. Eating it would
    // make the parser merge the following directive into this one and break
    // formatter idempotence on real-world `.ssl` sources.
    if (text.endsWith("\r\n")) return text.slice(0, -2);
    if (text.endsWith("\n")) return text.slice(0, -1);
    return text;
}

// Normalize comment spacing:
// - Block comments: exactly one space after opening and before closing
// - Line comments: exactly one space after //
export function normalizeComment(text: string): string {
    if (text.startsWith("/*")) {
        // Block comment - normalize spaces
        const inner = text.slice(2, -2);
        const isMultiline = inner.includes("\n");

        if (isMultiline) {
            // For multiline: ensure space after /* if content on same line,
            // and space before */ if content on same line
            let result = inner;
            // Fix start: if first char is not newline, ensure single space
            if (result.length > 0 && result[0] !== "\n") {
                result = result.replace(/^[ \t]*/, " ");
            }
            // Fix end: if last char is not newline, ensure single space before */
            if (result.length > 0 && !result.endsWith("\n")) {
                result = result.replace(/[ \t]*$/, " ");
            }
            return `/*${result}*/`;
        } else {
            // Single line block comment: /* text */
            const trimmed = inner.trim();
            if (trimmed.length === 0) {
                return "/* */";
            }
            return `/* ${trimmed} */`;
        }
    } else if (text.startsWith("//")) {
        // Line comment - ensure single space after //
        const inner = text.slice(2);
        const trimmed = inner.replace(/^[ \t]*/, "");
        if (trimmed.length === 0) {
            return "//";
        }
        return `// ${trimmed}`;
    }
    return text;
}

interface FormatResult {
    text: string;
}

export function formatDocument(node: SyntaxNode, options: FormatOptions = DEFAULT_OPTIONS): FormatResult {
    throwOnParseError(node);

    ctx = {
        indent: " ".repeat(options.indentSize),
        lineLimit: options.lineLimit,
    };
    // Strip \r from output — tree-sitter node.text preserves original line endings,
    // but the formatter joins parts with \n. Mixed endings cause non-idempotent output.
    const text = formatNode(node, 0).replace(/\r/g, "");
    return { text };
}

export function formatNode(node: SyntaxNode, depth: number): string {
    // Handle ERROR nodes: preserve original text
    if (node.type === SyntaxType.ERROR) {
        return node.text;
    }

    switch (node.type) {
        case SyntaxType.SourceFile: {
            const content = formatChildren(node, depth);
            // Replace tabs and ensure exactly one leading/trailing newline.
            // The trailing strip is a manual scan rather than `/\n+$/` because
            // `\n+` followed by `$` is polynomial: the engine retries every
            // starting position on input with internal `\n` runs, giving O(n²)
            // (CodeQL js/polynomial-redos). The leading-`/^\n+/` is anchored
            // and therefore linear.
            const expanded = content.replace(/\t/g, ctx.indent).replace(/^\n+/, "");
            let endIdx = expanded.length;
            while (endIdx > 0 && expanded.charCodeAt(endIdx - 1) === 10) endIdx--;
            return expanded.slice(0, endIdx) + "\n";
        }
        case SyntaxType.Preprocessor:
            // Trailing comment handling is done by callers (formatProcedure, formatChildren)
            // to avoid double-appending when the comment is a separate tree-sitter node
            return normalizePreprocessor(node.text);
        case SyntaxType.Comment:
        case SyntaxType.LineComment:
            return normalizeComment(node.text);
        case SyntaxType.ProcedureForward:
            return formatProcedureForward(node);
        case SyntaxType.Procedure:
            return formatProcedure(node, depth);
        case SyntaxType.VariableDecl:
            return formatVariableDecl(node, depth);
        case SyntaxType.ExportDecl:
            return formatExportDecl(node);
        case SyntaxType.IfStmt:
            return formatIfStmt(node, depth);
        case SyntaxType.WhileStmt:
            return formatWhileStmt(node, depth);
        case SyntaxType.ForStmt:
            return formatForStmt(node, depth);
        case SyntaxType.ForeachStmt:
            return formatForeachStmt(node, depth);
        case SyntaxType.SwitchStmt:
            return formatSwitchStmt(node, depth);
        case SyntaxType.ReturnStmt: {
            // Grammar has no field name, expression is the only named child
            const expr = node.namedChildren[0];
            // Column for expression: depth indent + "return "
            const column = depth * ctx.indent.length + 7;
            return `return${expr ? " " + formatExpression(expr, column, 1) : ""};`;
        }
        case SyntaxType.CallStmt:
            return formatCallStmt(node);
        case SyntaxType.Assignment:
            return formatAssignment(node);
        case SyntaxType.ExpressionStmt:
            return formatExpressionStmt(node, depth);
        case SyntaxType.Block:
            return formatBlock(node, depth);
        default:
            return node.text;
    }
}

function formatChildren(node: SyntaxNode, depth: number): string {
    const parts: string[] = [];
    const children = node.children;
    let needsBlankLine = false;

    children.forEach((child, i) => {
        const prevChild = children[i - 1]; // undefined at start
        const nextChild = children[i + 1]; // undefined at end

        const hadBlankLineBefore = prevChild !== undefined && child.startPosition.row - contentEndRow(prevChild) > 1;
        const trailingComment = hasTrailingComment(child, nextChild);

        if (isComment(child)) {
            // Skip if already appended as trailing comment
            if (prevChild && contentEndRow(prevChild) === child.startPosition.row) {
                return;
            }

            const immediatelyAfterProcedure = prevChild?.type === SyntaxType.Procedure && !hadBlankLineBefore;

            if (parts.length > 0 && !immediatelyAfterProcedure) {
                if (needsBlankLine || hadBlankLineBefore) {
                    parts.push("");
                    needsBlankLine = false;
                }
            }
            parts.push(normalizeComment(child.text));
            if (immediatelyAfterProcedure) {
                needsBlankLine = true;
            }
        } else if (child.type === SyntaxType.Preprocessor) {
            // Preserve one blank line between preprocessor groups when original had one
            if (parts.length > 0 && (needsBlankLine || hadBlankLineBefore)) {
                parts.push("");
                needsBlankLine = false;
            }
            let preprocessorText = normalizePreprocessor(child.text);
            // Check if next sibling is a line comment on the same line
            // Use contentEndRow: #define nodes include trailing \n, so endPosition.row
            // is 1 past the content — would falsely match a comment on the next line.
            if (
                nextChild &&
                nextChild.type === SyntaxType.LineComment &&
                nextChild.startPosition.row === contentEndRow(child)
            ) {
                // Add the comment on the same line
                preprocessorText = preprocessorText.trimEnd() + "    " + normalizeComment(nextChild.text);
            }
            parts.push(preprocessorText);
        } else if (child.type === SyntaxType.Procedure) {
            // Add blank line before procedure if not preceded by doc comment
            if (parts.length > 0) {
                if (needsBlankLine || hadBlankLineBefore) {
                    parts.push("");
                    needsBlankLine = false;
                } else {
                    const lastPart = parts[parts.length - 1];
                    if (lastPart && !lastPart.startsWith("/*") && !lastPart.startsWith("//")) {
                        parts.push("");
                    }
                }
            }

            let formatted = formatNode(child, depth);
            if (trailingComment && nextChild) {
                formatted += ctx.indent + normalizeComment(nextChild.text);
            }
            parts.push(formatted);
            needsBlankLine = true;
        } else {
            if (needsBlankLine && parts.length > 0) {
                parts.push("");
                needsBlankLine = false;
            }
            let formatted = formatNode(child, depth);
            if (trailingComment && nextChild) {
                formatted += ctx.indent + normalizeComment(nextChild.text);
            }
            parts.push(formatted);
        }
    });

    return parts.join("\n");
}

function formatProcedureForward(node: SyntaxNode): string {
    const name = node.childForFieldName("name")?.text || "";
    const params = node.childForFieldName("params");
    if (params) {
        return `procedure ${name}${formatParamList(params)};`;
    }
    return `procedure ${name};`;
}

function formatProcedure(node: SyntaxNode, depth: number): string {
    const name = node.childForFieldName("name")?.text || "";
    const params = node.childForFieldName("params");

    const header = params ? `procedure ${name}${formatParamList(params)} begin` : `procedure ${name} begin`;

    const bodyParts: string[] = [];
    const skipTypes: Set<string> = new Set([SyntaxType.Identifier, SyntaxType.ParamList]);
    const children = node.children;

    children.forEach((child, i) => {
        const nextChild = children[i + 1]; // undefined at end
        const prevChild = children[i - 1]; // undefined at start

        if (skipTypes.has(child.type)) return;
        // Skip begin/end/procedure keywords - they may appear as identifiers due to macros
        // (e.g., `else begin` after a macro that expands to if-then-begin-end).
        // Content validation catches any actual semantic changes.
        if (BEGIN_END_PROCEDURE_REGEX.test(child.text)) {
            return;
        }
        if (child.type.includes("procedure")) return;

        const hadBlankLineBefore = prevChild !== undefined && child.startPosition.row - contentEndRow(prevChild) > 1;
        const trailingComment = hasTrailingComment(child, nextChild);

        if (isComment(child)) {
            // Skip if already appended as trailing comment
            if (prevChild && contentEndRow(prevChild) === child.startPosition.row) {
                return;
            }
            if (bodyParts.length > 0 && hadBlankLineBefore) {
                bodyParts.push("");
            }
            bodyParts.push(ctx.indent + normalizeComment(child.text));
        } else {
            // Preserve one blank line when the original source had one
            if (bodyParts.length > 0 && hadBlankLineBefore) {
                bodyParts.push("");
            }
            let formatted = formatNode(child, depth + 1);
            if (trailingComment && nextChild) {
                formatted += ctx.indent + normalizeComment(nextChild.text);
            }
            if (formatted.trim()) {
                bodyParts.push(ctx.indent + formatted);
            }
        }
    });

    if (bodyParts.length === 0) {
        return `${header}\nend`;
    }
    return `${header}\n${bodyParts.join("\n")}\nend`;
}

function formatParamList(node: SyntaxNode): string {
    const params: string[] = [];
    for (const child of node.children) {
        if (child.type === SyntaxType.Param) {
            params.push(formatParam(child));
        }
    }
    return `(${params.join(", ")})`;
}

function formatParam(node: SyntaxNode): string {
    const hasVariable = node.children.some((c) => c.text === "variable");
    const name = node.childForFieldName("name")?.text || "";
    const defaultValue = node.childForFieldName("default");

    let result = hasVariable ? `variable ${name}` : name;
    if (defaultValue) {
        // Preserve := vs = from original
        const op = node.children.find((c) => c.text === ":=" || c.text === "=")?.text || "=";
        result += ` ${op} ${formatExpression(defaultValue)}`;
    }
    return result;
}

function formatVariableDecl(node: SyntaxNode, depth: number = 0): string {
    const hasBegin = node.children.some((c) => c.text.match(/^begin$/i));
    if (hasBegin) {
        // Group var_inits by semicolon - comma-separated inits share a line
        const lines: string[] = [];
        let currentGroup: string[] = [];
        for (const child of node.children) {
            if (child.type === SyntaxType.VarInit) {
                currentGroup.push(formatVarInit(child, depth + 1));
            } else if (child.text === ";") {
                if (currentGroup.length > 0) {
                    lines.push(ctx.indent + currentGroup.join(", ") + ";");
                    currentGroup = [];
                }
            }
        }
        // Handle any remaining var_inits (shouldn't happen with well-formed input)
        if (currentGroup.length > 0) {
            lines.push(ctx.indent + currentGroup.join(", ") + ";");
        }
        return `variable begin\n${lines.join("\n")}\nend`;
    }

    const hasImport = node.children.some((c) => c.text === "import");
    const hasSemicolon = node.children.some((c) => c.text === ";");
    const prefix = hasImport ? "import variable " : "variable ";
    const varInits: string[] = [];
    for (const child of node.children) {
        if (child.type === SyntaxType.VarInit) {
            varInits.push(formatVarInit(child, depth, prefix.length));
        }
    }

    return `${prefix}${varInits.join(", ")}${hasSemicolon ? ";" : ""}`;
}

function formatVarInit(node: SyntaxNode, depth: number = 0, prefixLen: number = 0): string {
    const name = node.childForFieldName("name")?.text || "";
    const size = node.childForFieldName("size");
    const value = node.childForFieldName("value");

    let result = name;
    if (size) {
        result += `[${formatExpression(size)}]`;
    }
    if (value) {
        // Preserve := vs = from original
        const op = node.children.find((c) => c.text === ":=" || c.text === "=")?.text || "=";
        // Column = indent + prefix + name + " op "
        const column = depth * ctx.indent.length + prefixLen + name.length + op.length + 2;
        result += ` ${op} ${formatExpression(value, column)}`;
    }
    return result;
}

function formatExportDecl(node: SyntaxNode): string {
    const name = node.childForFieldName("name")?.text || "";
    const value = node.childForFieldName("value");
    if (value) {
        const op = node.children.find((c) => c.text === ":=" || c.text === "=")?.text || "=";
        return `export variable ${name} ${op} ${formatExpression(value)};`;
    }
    return `export variable ${name};`;
}

export function formatBlock(node: SyntaxNode, depth: number): string {
    const stmts: string[] = [];
    const children = node.children;
    let beginComment = "";
    let endComment = "";

    // Check if first non-begin child is a comment on same line as begin
    const blockStartRow = node.startPosition.row;
    const blockEndRow = node.endPosition.row;

    // Find trailing comment on end
    for (const child of children) {
        if (isComment(child) && child.startPosition.row === blockEndRow) {
            endComment = ctx.indent + normalizeComment(child.text);
            break;
        }
    }

    children.forEach((child, i) => {
        const nextChild = children[i + 1]; // undefined at end
        const prevChild = children[i - 1]; // undefined at start

        if (BEGIN_END_REGEX.test(child.text)) {
            return;
        }

        // Check if this is a comment on same line as begin
        if (isComment(child) && child.startPosition.row === blockStartRow) {
            beginComment = ctx.indent + normalizeComment(child.text);
            return;
        }

        // Skip comment on same line as end (handled separately)
        if (isComment(child) && child.startPosition.row === blockEndRow) {
            return;
        }

        const trailingComment = hasTrailingComment(child, nextChild);

        if (isComment(child)) {
            // Skip if already appended as trailing comment
            if (prevChild && contentEndRow(prevChild) === child.startPosition.row) {
                return;
            }
            stmts.push(ctx.indent.repeat(depth + 1) + normalizeComment(child.text));
        } else {
            let formatted = formatNode(child, depth + 1);
            if (trailingComment && nextChild) {
                formatted += ctx.indent + normalizeComment(nextChild.text);
            }
            if (formatted.trim()) {
                stmts.push(ctx.indent.repeat(depth + 1) + formatted);
            }
        }
    });

    if (stmts.length === 0) {
        return `begin${beginComment}\nend${endComment}`;
    }

    return `begin${beginComment}\n${stmts.join("\n")}\n${ctx.indent.repeat(depth)}end${endComment}`;
}
