/**
 * AST utility functions for WeiDU D language.
 * Provides position-based comment detection for shouldProvideFeatures.
 */

import { createIsInsideComment } from "../shared/comment-check";
import { isInitialized, parseWithCache } from "../../../shared/parsers/weidu-d";
import { SyntaxType } from "./tree-sitter.d";

/** Comment node types in the D grammar. */
const D_COMMENT_TYPES: ReadonlySet<string> = new Set([SyntaxType.Comment, SyntaxType.LineComment]);

export const isInsideComment = createIsInsideComment(isInitialized, parseWithCache, D_COMMENT_TYPES);
