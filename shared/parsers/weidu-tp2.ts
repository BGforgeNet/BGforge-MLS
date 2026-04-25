/**
 * Tree-sitter parser for WeiDU TP2 — thin re-export from ParserManager.
 */

import { parserManager } from "./parser-manager";
import { LANG_WEIDU_TP2 } from "../languages";

export const initParser = () => parserManager.initOne(LANG_WEIDU_TP2, "tree-sitter-weidu_tp2.wasm", "WeiDU TP2");
export const getParser = () => parserManager.getParser(LANG_WEIDU_TP2);
export const isInitialized = () => parserManager.isInitialized(LANG_WEIDU_TP2);
export const parseWithCache = (text: string) => parserManager.parseWithCache(LANG_WEIDU_TP2, text);
