// Format-pipeline helpers (validation + comment stripping for safety checks)
export {
    stripBom,
    validateFormatting,
    stripCommentsWeidu,
    stripCommentsFalloutSsl,
    stripCommentsTra,
    stripCommentsFalloutMsg,
    stripComments2da,
    stripCommentsFalloutScriptsLst,
    tokenizeWeidu,
    normalizeWhitespaceWeidu,
    throwOnParseError,
    WeiduTokenType,
} from "./format-utils";
export type { CommentStripper, WeiduToken, FormatOutput } from "./format-utils";

// Editorconfig discovery (CLI uses directly; server's format-options wraps this)
export { getEditorconfigSettings } from "./editorconfig";
