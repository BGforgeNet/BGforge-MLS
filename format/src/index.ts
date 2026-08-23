/**
 * Public entry point for @bgforge/format.
 *
 * Scope: format a document, and the pipeline needed to do that safely. Grammar-shaped helpers move
 * whenever a grammar does and carry no semver promise, so they live in ./internal instead.
 */

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

// Safety pipeline: parse-error guard before formatting, content guard after it
export { stripBom, throwOnParseError, validateFormatting } from "./format-utils";
export type { CompareNormalizer, FormatOutput } from "./format-utils";

// Per-language normalizers for validateFormatting's content guard
export {
    stripCommentsWeidu,
    stripCommentsFalloutSsl,
    stripCommentsTra,
    stripCommentsFalloutMsg,
    stripComments2da,
    stripCommentsFalloutScriptsLst,
} from "./format-utils";
export { stripCommentsForCompareFalloutSsl } from "./fallout-ssl/canonical-keyword";

// Editorconfig discovery (CLI uses directly; server's format-options wraps this)
export { getEditorconfigSettings } from "./editorconfig";
