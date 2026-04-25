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

// Tree-based formatters: caller passes the parsed rootNode + options
export { formatDocument as formatFalloutSsl } from "./fallout-ssl/core";
export { formatDocument as formatWeiduBaf } from "./weidu-baf/core";
export { formatDocument as formatWeiduD } from "./weidu-d/core";
export { formatDocument as formatWeiduTp2 } from "./weidu-tp2/core";

// Pure-string formatters: caller passes raw text
export { formatTra } from "./weidu-tra";
export { formatMsg } from "./fallout-msg";
export { format2da } from "./infinity-2da";
export { formatScriptsLst } from "./fallout-scripts-lst";

// TP2 types and constants used by server providers and tests
export { DEFAULT_OPTIONS as weiduTp2DefaultOptions, KW_BEGIN, KW_END } from "./weidu-tp2/types";

// TP2 utilities used by server symbol provider, snippets, and tests
export {
    normalizeLineComment,
    normalizeBlockComment,
    normalizeComment,
    normalizeWhitespace,
    withNormalizedComment,
    isAction,
    isPatch,
    isControlFlow,
    isCopyAction,
    isFunctionDef,
    isFunctionCall,
    isBodyContent,
} from "./weidu-tp2/utils";
