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

// Mutual recursion, not a layering slip: a control-flow statement nests a block of statements, so
// `control-flow` calls back into this module's `formatNode`/`formatBlock`, and `expressions` shares
// its format context.
import {
    formatElseClause,
    formatIfStmt,
    formatWhileStmt,
    formatForStmt,
    formatForeachStmt,
    formatSwitchStmt,
} from "./control-flow";
import { formatExpression, formatCallStmt, formatAssignment, formatExpressionStmt } from "./expressions";
import { SyntaxType } from "@bgforge/shared/syntax-types/fallout-ssl";

import {
    throwOnParseError,
    restoreLostComments,
    reportRescuedComments,
    commentItem,
    itemsOf,
    terminate,
    weave,
    type WovenItem,
    normalizeComment,
    falloutSslLineCommentStart,
    tokenizeFalloutSsl,
    WeiduTokenType,
    EDGE_BLANKS,
    TRAILING_BLANKS,
} from "../format-utils";
import { canonicalKeyword } from "./canonical-keyword";
// Comment normalization is shared across all formatters; re-export the imported
// binding so existing `./core` importers (e.g. control-flow) keep their path.
export { normalizeComment } from "../format-utils";
import { type FormatOptions, DEFAULT_OPTIONS, type FormatResult } from "../format-types";

// Shared format-pipeline helper; re-export so `./core` importers (expressions) keep their path.
export { throwFormatError } from "../format-types";

// Format context passed through all functions (SSL-specific shape)
interface FormatContext {
    indent: string;
    lineLimit: number;
}

// Module-level mutable state. The SSL formatter is split across three files
// (core.ts, control-flow.ts, expressions.ts); shared access via `getCtx()` avoids
// threading a `FormatContext` argument through every formatter signature in the
// split. Safe because Node is single-threaded and each `formatDocument()` call
// resets this synchronously before any formatter reads it.
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

/**
 * `text` with `comment` at the end of its last line - or on a line of its own at `indent`, when that line ends in a
 * line comment already, which would take the new one into itself.
 */
function withTrailingComment(text: string, comment: SyntaxNode, indent: string): string {
    const lastLine = text.slice(text.lastIndexOf("\n") + 1);
    const normalized = normalizeComment(comment.text);
    return falloutSslLineCommentStart(lastLine) === -1
        ? text + ctx.indent + normalized
        : text + "\n" + indent + normalized;
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
    // The comment branches return `code + indent + comment`, with no tail -
    // matching the original regexes' `[\r\n]*$` consumption.
    let tailStart = text.length;
    while (tailStart > 0) {
        const c = text.codePointAt(tailStart - 1)!;
        if (c !== 10 && c !== 13) break;
        tailStart--;
    }
    const body = text.slice(0, tailStart);

    // Trailing line comment: split at the first "//" with non-empty code before it. A `#define` body can hold a
    // string literal (`"http://..."`), so the `//` is found by token rather than by substring.
    const slashIdx = falloutSslLineCommentStart(body);
    if (slashIdx > 0) {
        const code = body.slice(0, slashIdx).replace(TRAILING_BLANKS, "");
        const comment = body.slice(slashIdx);
        if (code && !comment.includes("\n")) {
            return code + ctx.indent + normalizeComment(comment);
        }
    }

    // Trailing block comment, single line only and ending the directive. It starts where the last comment token
    // does, not at the last `/*`: a block comment does not nest, so a `/*` inside one is text.
    const tokens = tokenizeFalloutSsl(body);
    const last = tokens[tokens.length - 1];
    if (
        last?.type === WeiduTokenType.Comment &&
        last.text.startsWith("/*") &&
        last.text.endsWith("*/") &&
        !last.text.includes("\n")
    ) {
        const code = body.slice(0, body.length - last.text.length).replace(TRAILING_BLANKS, "");
        if (code) {
            return code + ctx.indent + normalizeComment(last.text);
        }
    }

    // No comment branch: strip exactly one `\r?\n` at the end, matching the
    // original `text.replace(/\r?\n$/, "")`. Trailing newlines beyond the
    // first are load-bearing - a multiline `#define` whose body ends with
    // `\<newline><blank-line-newline>` relies on that blank-continuation
    // newline to terminate the macro on the next reparse. Eating it would
    // make the parser merge the following directive into this one and break
    // formatter idempotence on real-world `.ssl` sources.
    if (text.endsWith("\r\n")) return text.slice(0, -2);
    if (text.endsWith("\n")) return text.slice(0, -1);
    return text;
}

/** Replace tabs with the indent unit everywhere except inside string literals and comments, whose tabs are content. */
function expandTabsOutsideStrings(text: string): string {
    return tokenizeFalloutSsl(text)
        .map((token) => (token.type === WeiduTokenType.Code ? token.text.replaceAll("\t", ctx.indent) : token.text))
        .join("");
}

export function formatDocument(node: SyntaxNode, options: FormatOptions = DEFAULT_OPTIONS): FormatResult {
    return reportRescuedComments(() => formatDocumentText(node, options));
}

function formatDocumentText(node: SyntaxNode, options: FormatOptions): FormatResult {
    throwOnParseError(node);

    ctx = {
        indent: " ".repeat(options.indentSize),
        lineLimit: options.lineLimit,
    };
    // Strip \r from output - tree-sitter node.text preserves original line endings,
    // but the formatter joins parts with \n. Mixed endings cause non-idempotent output.
    const text = formatNode(node, 0).replaceAll("\r", "");
    return { text };
}

/**
 * Format a node. Most node formatters rebuild the node from the children they pick, so a comment they do not
 * pick would vanish; restoreLostComments writes each one back on a line of its own. The caller puts the first
 * line at `depth`, so the lines after it are indented to match.
 */
export function formatNode(node: SyntaxNode, depth: number): string {
    const formatted = formatNodeWithoutLostComments(node, depth);
    if (isComment(node) || node.type === SyntaxType.SourceFile) return formatted;
    return restoreLostComments(node, formatted, false, ctx.indent.repeat(depth), false);
}

function formatNodeWithoutLostComments(node: SyntaxNode, depth: number): string {
    switch (node.type) {
        case SyntaxType.SourceFile: {
            const content = formatChildren(node, depth);
            // Replace tabs and ensure exactly one leading/trailing newline.
            // The trailing strip is a manual scan rather than `/\n+$/` because
            // `\n+` followed by `$` is polynomial: the engine retries every
            // starting position on input with internal `\n` runs, giving O(n²)
            // (CodeQL js/polynomial-redos). The leading-`/^\n+/` is anchored
            // and therefore linear.
            const expanded = expandTabsOutsideStrings(content).replace(/^\n+/, "");
            let endIdx = expanded.length;
            while (endIdx > 0 && expanded.codePointAt(endIdx - 1) === 10) endIdx--;
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
        case SyntaxType.ProcedureForwardBlock:
            return formatProcedureForwardBlock(node);
        case SyntaxType.Procedure:
            return formatProcedure(node, depth);
        case SyntaxType.VariableDecl:
            return formatVariableDecl(node, depth);
        case SyntaxType.ExportDecl:
            return formatExportDecl(node);
        case SyntaxType.IfStmt:
            return formatIfStmt(node, depth);
        case SyntaxType.ElseClause:
            return formatElseClause(node, depth);
        case SyntaxType.WhileStmt:
            return formatWhileStmt(node, depth);
        case SyntaxType.ForStmt:
            return formatForStmt(node, depth);
        case SyntaxType.ForeachStmt:
            return formatForeachStmt(node, depth);
        case SyntaxType.SwitchStmt:
            return formatSwitchStmt(node, depth);
        case SyntaxType.ReturnStmt: {
            // Grammar has no field name, expression is the only named child that is not a comment
            const expr = node.namedChildren.find((child) => !isComment(child));
            // Column for expression: depth indent + "return "
            const column = depth * ctx.indent.length + 7;
            return weave(
                terminate(
                    itemsOf(node.children, (child) => {
                        if (child.type === "return") return { text: canonicalKeyword("return"), sep: "" };
                        if (child.id === expr?.id) return { text: formatExpression(child, column, 1), sep: " " };
                        return child.type === ";" ? { text: ";", sep: "" } : null;
                    }),
                    ";",
                ),
                ctx.indent.repeat(depth + 1),
            );
        }
        case SyntaxType.CallStmt:
            return formatCallStmt(node, depth);
        case SyntaxType.Assignment:
            return formatAssignment(node, depth);
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
    // The comments already written at the end of the line of the node before them.
    const appended = new Set<number>();

    children.forEach((child, i) => {
        const prevChild = children[i - 1]; // undefined at start
        const nextChild = children[i + 1]; // undefined at end

        const hadBlankLineBefore = prevChild !== undefined && child.startPosition.row - contentEndRow(prevChild) > 1;
        const trailingComment = hasTrailingComment(child, nextChild) && !(nextChild && appended.has(nextChild.id));

        if (isComment(child)) {
            if (appended.has(child.id)) return;

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
            // is 1 past the content - would falsely match a comment on the next line.
            if (
                nextChild &&
                nextChild.type === SyntaxType.LineComment &&
                nextChild.startPosition.row === contentEndRow(child)
            ) {
                // Add the comment on the same line
                preprocessorText =
                    preprocessorText.replace(TRAILING_BLANKS, "") + "    " + normalizeComment(nextChild.text);
                appended.add(nextChild.id);
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
                formatted = withTrailingComment(formatted, nextChild, ctx.indent.repeat(depth));
                appended.add(nextChild.id);
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
                formatted = withTrailingComment(formatted, nextChild, ctx.indent.repeat(depth));
                appended.add(nextChild.id);
            }
            parts.push(formatted);
        }
    });

    return parts.join("\n");
}

/**
 * Everything ahead of the `procedure` keyword. Rebuilding the header from fields means anything not
 * named here is dropped from the output - and a dropped modifier changes what the script compiles to,
 * silently, on a file the user only asked to reformat.
 */
function formatProcedureModifiers(node: SyntaxNode): string {
    return ["linkage", "critical", "modifier"]
        .map((field) => node.childForFieldName(field))
        .map((word) => (word ? `${canonicalKeyword(word.text)} ` : ""))
        .join("");
}

/** The `in <constant>` or `when <expr>` clause that sits between the parameter list and `begin`. */
function formatProcedureSchedule(node: SyntaxNode): string {
    const timed = node.childForFieldName("timed");
    if (timed) return ` ${canonicalKeyword("in")} ${formatNode(timed, 0)}`;
    const condition = node.childForFieldName("condition");
    return condition ? ` ${canonicalKeyword("when")} ${formatNode(condition, 0)}` : "";
}

function formatProcedureForward(node: SyntaxNode): string {
    const modifiers = new Set(["linkage", "critical", "modifier"].map((field) => node.childForFieldName(field)?.id));
    const name = node.childForFieldName("name");
    const params = node.childForFieldName("params");
    return weave(
        terminate(
            itemsOf(node.children, (child) => {
                if (modifiers.has(child.id)) return { text: canonicalKeyword(child.text), sep: " " };
                if (child.type === SyntaxType.Procedure) return { text: canonicalKeyword("procedure"), sep: " " };
                if (child.id === name?.id) return { text: child.text, sep: " " };
                if (child.id === params?.id) return { text: formatParamList(child), sep: "" };
                return child.type === ";" ? { text: ";", sep: "" } : null;
            }),
            ";",
        ),
        ctx.indent,
    );
}

/** `name(params);`: a forward declaration after its `procedure` keyword, or one entry of an import block. */
function formatProcedureDeclarator(node: SyntaxNode): string {
    const name = node.childForFieldName("name")?.text || "";
    const params = node.childForFieldName("params");
    return `${name}${params ? formatParamList(params) : ""};`;
}

/** `import procedure begin ... end`, one declaration per line. A comment inside keeps the block verbatim. */
function formatProcedureForwardBlock(node: SyntaxNode): string {
    if (node.children.some((child) => isComment(child))) return node.text;
    const lines = node.namedChildren
        .filter((child) => child?.type === SyntaxType.ProcedureForward)
        .map((child) => ctx.indent + formatProcedureDeclarator(child!));
    const header = `${formatProcedureModifiers(node)}${canonicalKeyword("procedure")} ${canonicalKeyword("begin")}`;
    return [header, ...lines, canonicalKeyword("end")].join("\n");
}

function formatProcedure(node: SyntaxNode, depth: number): string {
    const name = node.childForFieldName("name")?.text || "";
    const params = node.childForFieldName("params");

    const signature =
        `${formatProcedureModifiers(node)}${canonicalKeyword("procedure")} ${name}` +
        `${params ? formatParamList(params) : ""}`;
    // A comment after the procedure's `begin` on its line stays there, as it does after a block's `begin`.
    const beginKeyword = node.children.find((child) => !isComment(child) && /^begin$/i.test(child.text));
    const beginComment = beginKeyword
        ? node.children.find(
              (child) =>
                  isComment(child) &&
                  child.startPosition.row === beginKeyword.endPosition.row &&
                  child.startIndex >= beginKeyword.endIndex,
          )
        : undefined;
    // The comments between the signature and `begin` stay in the header, ahead of the begin's own, as written: a `//`
    // one ends the line and `begin` starts the next.
    const headComments = beginKeyword
        ? node.children.filter((child) => isComment(child) && child.endIndex <= beginKeyword.startIndex)
        : [];
    const header =
        weave(
            [
                { text: `${signature}${formatProcedureSchedule(node)}`, sep: "" },
                ...headComments.map((comment) => commentItem(comment)),
                { text: canonicalKeyword("begin"), sep: " " },
            ],
            ctx.indent.repeat(depth),
        ) + (beginComment ? ctx.indent + normalizeComment(beginComment.text) : "");

    const bodyParts: string[] = [];
    const skipTypes: Set<string> = new Set([SyntaxType.Identifier, SyntaxType.ParamList]);
    // The schedule clause is already in the header. Its operand is an ordinary expression node, so it
    // is skipped by identity - matching on type would swallow a body statement of the same shape.
    const scheduleIds = new Set(
        [node.childForFieldName("timed"), node.childForFieldName("condition")]
            .filter((n): n is SyntaxNode => n !== null)
            .map((n) => n.id),
    );
    const children = node.children;
    // The comments already written at the end of a line: the begin's, and each statement's before them.
    const appended = new Set<number>([
        ...headComments.map((comment) => comment.id),
        ...(beginComment ? [beginComment.id] : []),
    ]);

    children.forEach((child, i) => {
        const nextChild = children[i + 1]; // undefined at end
        const prevChild = children[i - 1]; // undefined at start

        if (skipTypes.has(child.type)) return;
        if (scheduleIds.has(child.id)) return;
        // The keyword introducing the clause, dropped alongside the operand above.
        if (scheduleIds.size > 0 && /^(?:in|when)$/i.test(child.text)) return;
        // Skip the procedure's own begin/end/procedure keywords; the header and footer above write them.
        if (BEGIN_END_PROCEDURE_REGEX.test(child.text)) {
            return;
        }
        if (child.type.includes("procedure")) return;

        const hadBlankLineBefore = prevChild !== undefined && child.startPosition.row - contentEndRow(prevChild) > 1;
        const trailingComment = hasTrailingComment(child, nextChild) && !(nextChild && appended.has(nextChild.id));

        if (isComment(child)) {
            // Skip if already appended as trailing comment, or written after the begin
            if (appended.has(child.id)) {
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
                formatted = withTrailingComment(formatted, nextChild, ctx.indent.repeat(depth + 1));
                appended.add(nextChild.id);
            }
            if (formatted.replace(EDGE_BLANKS, "")) {
                bodyParts.push(ctx.indent + formatted);
            }
        }
    });

    const kwEnd = canonicalKeyword("end");
    if (bodyParts.length === 0) {
        return `${header}\n${kwEnd}`;
    }
    return `${header}\n${bodyParts.join("\n")}\n${kwEnd}`;
}

function formatParamList(node: SyntaxNode): string {
    // The language allows one comma after the last parameter and both compilers accept it, emitting the
    // same bytecode either way. Rebuilding the list from the `param` children alone would drop that token,
    // which the content guard reads as lost code - so the whole file gets refused rather than formatted.
    // Punctuation is matched by text because the generated SyntaxType enum covers only named nodes.
    let first = true;
    return weave(
        terminate(
            itemsOf(node.children, (child) => {
                if (child.type === SyntaxType.Param) {
                    const sep = first ? "" : " ";
                    first = false;
                    return { text: formatParam(child), sep };
                }
                return child.text === "," || child.text === "(" || child.text === ")"
                    ? { text: child.text, sep: "" }
                    : null;
            }),
            ")",
        ),
        ctx.indent,
    );
}

function formatParam(node: SyntaxNode): string {
    const name = node.childForFieldName("name");
    const defaultValue = node.childForFieldName("default");

    return weave(
        itemsOf(node.children, (child) => {
            if (child.type === "variable") return { text: canonicalKeyword("variable"), sep: "" };
            if (child.id === name?.id) return { text: child.text, sep: " " };
            // Preserve := vs = from original
            if (child.type === ":=" || child.type === "=") return { text: child.text, sep: " " };
            return child.id === defaultValue?.id ? { text: formatExpression(child), sep: " " } : null;
        }),
        ctx.indent,
    );
}

function formatVariableDecl(node: SyntaxNode, depth: number = 0): string {
    const importKw = node.children.find((c) => c.type === "import");
    const hasBegin = node.children.some((c) => c.text.match(/^begin$/i));
    if (hasBegin) return formatDeclarationBlock(node, importKw ? "import" : undefined, depth);

    const prefix = `${importKw ? `${canonicalKeyword("import")} ` : ""}${canonicalKeyword("variable")} `;
    return weave(
        itemsOf(node.children, (child) => {
            if (child.type === "import") return { text: canonicalKeyword("import"), sep: "" };
            if (child.type === "variable") return { text: canonicalKeyword("variable"), sep: importKw ? " " : "" };
            if (child.type === SyntaxType.VarInit)
                return { text: formatVarInit(child, depth, prefix.length), sep: " " };
            return child.type === "," || child.type === ";" ? { text: child.type, sep: "" } : null;
        }),
        ctx.indent.repeat(depth + 1),
    );
}

function formatVarInit(node: SyntaxNode, depth: number = 0, prefixLen: number = 0): string {
    const name = node.childForFieldName("name");
    const size = node.childForFieldName("size");
    const flags = node.childForFieldName("flags");
    const value = node.childForFieldName("value");

    // Preserve := vs = from original
    const op = node.children.find((c) => c.text === ":=" || c.text === "=")?.text || "=";
    // Column = indent + prefix + name + " op "
    const column = depth * ctx.indent.length + prefixLen + (name?.text.length ?? 0) + op.length + 2;
    return weave(
        itemsOf(node.children, (child) => {
            if (child.id === name?.id) return { text: child.text, sep: "" };
            if (child.id === size?.id) return { text: formatExpression(child), sep: "" };
            // `b[4, 2]`: the second constant is the array's flags, written after a comma.
            if (child.id === flags?.id) return { text: formatExpression(child), sep: " " };
            if (child.type === "[" || child.type === "]" || child.type === ",") return { text: child.type, sep: "" };
            if (child.id === value?.id) return { text: formatExpression(child, column), sep: " " };
            return child.text === op ? { text: op, sep: " " } : null;
        }),
        ctx.indent.repeat(depth + 1),
    );
}

/**
 * `[import|export] variable begin`, the entries, `end`. A `variable` block puts the entries between two `;` on one
 * line; an `export` block has one entry to a line, each with its `;`, as joining two with a comma is a syntax error
 * there. A comment on the row of `begin` or of the line before it stays behind it, the others take lines of their own;
 * a comment between the parts of one line stays among them.
 */
function formatDeclarationBlock(node: SyntaxNode, linkage: "import" | "export" | undefined, depth: number): string {
    const children = node.children;
    const begin = children.findIndex((child) => child.type === "begin");
    const end = children.findLastIndex((child) => child.type === "end");
    const entryDepth = linkage === "export" ? 1 : depth + 1;
    const lines: string[] = [];
    let header = "";
    let group: WovenItem[] = [];
    let entries = 0;
    let lastRow = children[begin]?.endPosition.row;
    let lastLineIsCode = false;

    const flush = (): void => {
        if (entries === 0) return;
        lines.push(ctx.indent + weave(terminate(group, ";"), ctx.indent.repeat(2)));
        lastLineIsCode = true;
        group = [];
        entries = 0;
    };
    for (const child of children.slice(begin + 1, end)) {
        if (isComment(child)) {
            const text = normalizeComment(child.text);
            if (entries > 0) {
                group.push(commentItem(child));
            } else if (child.startPosition.row === lastRow) {
                if (lines.length === 0) header += (header === "" ? ctx.indent : " ") + text;
                else lines[lines.length - 1] += (lastLineIsCode ? ctx.indent : " ") + text;
                lastLineIsCode = false;
            } else {
                lines.push(ctx.indent + text);
                lastLineIsCode = false;
            }
            lastRow = child.endPosition.row;
        } else if (child.type === SyntaxType.VarInit) {
            if (linkage === "export") flush();
            group.push({ text: formatVarInit(child, entryDepth), sep: " " });
            entries++;
            lastRow = child.endPosition.row;
        } else if (child.type === ",") {
            group.push({ text: ",", sep: "" });
        } else if (child.type === ";") {
            group.push({ text: ";", sep: "" });
            lastRow = child.endPosition.row;
            flush();
        }
    }
    flush();

    const kwHeader = `${linkage ? `${canonicalKeyword(linkage)} ` : ""}${canonicalKeyword("variable")} ${canonicalKeyword("begin")}`;
    return [kwHeader + header, ...lines, canonicalKeyword("end")].join("\n");
}

function formatExportDecl(node: SyntaxNode): string {
    if (node.children.some((child) => child.type === "begin")) return formatDeclarationBlock(node, "export", 0);
    const name = node.childForFieldName("name");
    const value = node.childForFieldName("value");
    return weave(
        terminate(
            itemsOf(node.children, (child) => {
                if (child.type === "export") return { text: canonicalKeyword("export"), sep: "" };
                if (child.type === "variable") return { text: canonicalKeyword("variable"), sep: " " };
                if (child.id === name?.id) return { text: child.text, sep: " " };
                // Preserve := vs = from original
                if (child.type === ":=" || child.type === "=") return { text: child.text, sep: " " };
                if (child.id === value?.id) return { text: formatExpression(child), sep: " " };
                return child.type === ";" ? { text: ";", sep: "" } : null;
            }),
            ";",
        ),
        ctx.indent,
    );
}

export function formatBlock(node: SyntaxNode, depth: number): string {
    const stmts: string[] = [];
    const children = node.children;

    // The comments on the line of `begin` and on the line of `end` stay there, in order. A line comment takes the rest
    // of its line, so only the last of them can be one, which source order already guarantees.
    const blockStartRow = node.startPosition.row;
    const blockEndRow = node.endPosition.row;
    const onRow = (row: number): SyntaxNode[] =>
        children.filter((child) => isComment(child) && child.startPosition.row === row);
    const trailerOf = (comments: SyntaxNode[]): string =>
        comments.length === 0 ? "" : ctx.indent + comments.map((comment) => normalizeComment(comment.text)).join(" ");
    const beginComments = onRow(blockStartRow);
    const endComments = blockEndRow === blockStartRow ? [] : onRow(blockEndRow);
    const beginComment = trailerOf(beginComments);
    const endComment = trailerOf(endComments);
    // The comments already written at the end of the line of the statement before them.
    const appended = new Set<number>([...beginComments, ...endComments].map((comment) => comment.id));

    children.forEach((child, i) => {
        const nextChild = children[i + 1]; // undefined at end

        if (BEGIN_END_REGEX.test(child.text)) {
            return;
        }

        const trailingComment = hasTrailingComment(child, nextChild) && !(nextChild && appended.has(nextChild.id));

        if (isComment(child)) {
            if (appended.has(child.id)) return;
            stmts.push(ctx.indent.repeat(depth + 1) + normalizeComment(child.text));
        } else {
            let formatted = formatNode(child, depth + 1);
            if (trailingComment && nextChild) {
                formatted = withTrailingComment(formatted, nextChild, ctx.indent.repeat(depth + 1));
                appended.add(nextChild.id);
            }
            if (formatted.replace(EDGE_BLANKS, "")) {
                stmts.push(ctx.indent.repeat(depth + 1) + formatted);
            }
        }
    });

    const kwBegin = canonicalKeyword("begin");
    const kwEnd = canonicalKeyword("end");
    if (stmts.length === 0) {
        return `${kwBegin}${beginComment}\n${ctx.indent.repeat(depth)}${kwEnd}${endComment}`;
    }

    return `${kwBegin}${beginComment}\n${stmts.join("\n")}\n${ctx.indent.repeat(depth)}${kwEnd}${endComment}`;
}
