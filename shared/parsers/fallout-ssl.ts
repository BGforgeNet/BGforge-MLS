/**
 * Tree-sitter parser for Fallout SSL — thin re-export from ParserManager.
 */

import { parserManager } from "./parser-manager";
import { LANG_FALLOUT_SSL } from "../languages";

export const initParser = () => parserManager.initOne(LANG_FALLOUT_SSL, "tree-sitter-ssl.wasm", "SSL");
export const getParser = () => parserManager.getParser(LANG_FALLOUT_SSL);
export const isInitialized = () => parserManager.isInitialized(LANG_FALLOUT_SSL);
export const parseWithCache = (text: string) => parserManager.parseWithCache(LANG_FALLOUT_SSL, text);
