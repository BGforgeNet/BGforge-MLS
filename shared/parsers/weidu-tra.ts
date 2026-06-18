/**
 * Tree-sitter parser for WeiDU TRA - thin re-export from ParserManager.
 */

import { parserManager } from "./parser-manager";
import { LANG_WEIDU_TRA } from "../languages";

export const initParser = () => parserManager.initOne(LANG_WEIDU_TRA, "tree-sitter-weidu_tra.wasm", "WeiDU TRA");
export const getParser = () => parserManager.getParser(LANG_WEIDU_TRA);
export const isInitialized = () => parserManager.isInitialized(LANG_WEIDU_TRA);
export const parseWithCache = (text: string) => parserManager.parseWithCache(LANG_WEIDU_TRA, text);
