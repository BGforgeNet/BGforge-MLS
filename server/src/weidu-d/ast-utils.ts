/**
 * AST utility functions for WeiDU D language.
 * Provides position-based comment and string detection for feature gating.
 */

import { createIsInsideComment } from "../shared/comment-check";
import { createIsInsideString } from "../shared/string-check";
import { isInitialized, parseWithCache } from "../../../shared/parsers/weidu-d";
import { SyntaxType } from "./syntax-type";

/** Comment node types in the D grammar. */
const D_COMMENT_TYPES: ReadonlySet<string> = new Set([SyntaxType.Comment, SyntaxType.LineComment]);

export const isInsideComment = createIsInsideComment(isInitialized, parseWithCache, D_COMMENT_TYPES);

/**
 * The two concrete string node types, rather than the `string` node above them: `(AT "var")` holds a
 * `double_string` directly, so an ancestor walk looking only for `string` misses it.
 */
const D_STRING_TYPES: ReadonlySet<string> = new Set([SyntaxType.TildeString, SyntaxType.DoubleString]);

export const isInsideString = createIsInsideString(isInitialized, parseWithCache, D_STRING_TYPES);
