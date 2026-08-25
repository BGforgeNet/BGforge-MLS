/**
 * `@bgforge/bcs` - a codec for Infinity Engine compiled scripts.
 *
 * BCS is plain ASCII, not bytecode: nested two-letter block markers with numeric and quoted fields between
 * them. Reading one therefore needs no engine, no install and no IDS tables - which is what lets the round
 * trip be gated on byte-identity alone, before any name resolution exists.
 */

export { readBcs } from "./read";
export { writeBcs } from "./write";
export { decompileBcs } from "./decompile";
export type { BcsSymbols } from "./decompile";
export { BcsCompileError, compileBaf, compileSymbolsFrom } from "./compile";
export type { BcsCompileDiagnostic, BcsCompileSymbols, BcsSignatureRow, BcsTableSource } from "./compile";
export type { BcsEngine } from "./signature";
export type { BcsAction, BcsBlock, BcsObject, BcsResponse, BcsScript, BcsTrigger } from "./types";
