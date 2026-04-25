/**
 * Tree-sitter parser for WeiDU BAF — thin re-export from ParserManager.
 */

import { parserManager } from "./parser-manager";
import { LANG_WEIDU_BAF } from "../languages";

export const initParser = () => parserManager.initOne(LANG_WEIDU_BAF, "tree-sitter-baf.wasm", "BAF");
export const getParser = () => parserManager.getParser(LANG_WEIDU_BAF);
export const isInitialized = () => parserManager.isInitialized(LANG_WEIDU_BAF);
export const parseWithCache = (text: string) => parserManager.parseWithCache(LANG_WEIDU_BAF, text);
