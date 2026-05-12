/**
 * Tree-sitter parser for Lua - thin re-export from ParserManager.
 */

import { parserManager } from "./parser-manager";
import { LANG_LUA } from "../languages";

export const initParser = () => parserManager.initOne(LANG_LUA, "tree-sitter-lua.wasm", "Lua");
export const getParser = () => parserManager.getParser(LANG_LUA);
export const isInitialized = () => parserManager.isInitialized(LANG_LUA);
export const parseWithCache = (text: string) => parserManager.parseWithCache(LANG_LUA, text);
