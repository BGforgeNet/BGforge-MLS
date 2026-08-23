/**
 * In-repo entry point: helpers the BGforge MLS server's WeiDU TP2 provider and the test suites reach
 * for, which are shaped by the tree-sitter grammars rather than by anything a formatting caller does.
 *
 * Nothing here carries a semver promise - these move whenever a grammar does. Anything an outside
 * consumer of @bgforge/format should be able to call belongs in index.ts instead. Helpers used only
 * within format/src belong in neither: siblings import those from the defining module.
 */

// Tilde-delimited string scanning (WeiDU ~text~ / ~~~~~text~~~~~)
export { scanTildeDelimiter } from "./format-utils";
export type { TildeDelimiter } from "./format-utils";

// Comment normalizers, shared across the tree formatters
export { normalizeLineComment, normalizeBlockComment, normalizeComment } from "./format-utils";

// TP2 formatting defaults and keyword constants
export { DEFAULT_OPTIONS as weiduTp2DefaultOptions, KW_BEGIN, KW_END } from "./weidu-tp2/types";

// TP2 node predicates, used by the server's symbol, completion and snippet providers
export {
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
