/**
 * Tree-sitter parser for Fallout MSG - thin re-export from ParserManager.
 */

import { parserManager } from "./parser-manager";
import { LANG_FALLOUT_MSG } from "../languages";

export const initParser = () => parserManager.initOne(LANG_FALLOUT_MSG, "tree-sitter-fallout_msg.wasm", "Fallout MSG");
export const getParser = () => parserManager.getParser(LANG_FALLOUT_MSG);
export const isInitialized = () => parserManager.isInitialized(LANG_FALLOUT_MSG);
export const parseWithCache = (text: string) => parserManager.parseWithCache(LANG_FALLOUT_MSG, text);
