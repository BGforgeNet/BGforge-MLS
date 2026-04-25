/**
 * Tree-sitter parser for WeiDU D — thin re-export from ParserManager.
 */

import { parserManager } from "./parser-manager";
import { LANG_WEIDU_D } from "../languages";

export const initParser = () => parserManager.initOne(LANG_WEIDU_D, "tree-sitter-weidu_d.wasm", "WeiDU D");
export const getParser = () => parserManager.getParser(LANG_WEIDU_D);
export const isInitialized = () => parserManager.isInitialized(LANG_WEIDU_D);
export const parseWithCache = (text: string) => parserManager.parseWithCache(LANG_WEIDU_D, text);
