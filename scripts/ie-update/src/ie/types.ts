/**
 * Shared type definitions for IESDP and IElib data processing.
 * Used by all ie/ modules and the main entry point scripts.
 */

/** A single completion item for IDE intellisense */
export interface CompletionItem {
    readonly name: string;
    readonly detail: string;
    readonly doc: string;
    readonly type?: string;
}

/** A stanza entry in the IE data YAML structure */
export interface IEDataEntry {
    /** Stanza name used as YAML key in completion data files (server reads these) */
    readonly stanza: string;
    /** Stanza name used in highlight tmLanguage repository (defaults to stanza if not set) */
    readonly highlightStanza?: string;
    readonly scope: string;
    readonly items: readonly CompletionItem[];
    readonly completion_type?: number;
    readonly string?: boolean;
    /** When true, all doc fields use |- block scalar style (for litscal-wrapped values) */
    readonly blockDoc?: boolean;
}

/** Map of category name to IE data entries */
export type IEData = Record<string, IEDataEntry>;

/** An offset item from IESDP file format data */
export interface OffsetItem {
    readonly type: string;
    readonly desc: string;
    readonly offset?: number;
    readonly length?: number;
    readonly mult?: number;
    readonly id?: string;
    /** Truthy marker - YAML data uses 1, not true */
    readonly unused?: number | boolean;
    /** Truthy marker - YAML data uses 1, not true */
    readonly unknown?: number | boolean;
}

/** An action parameter from IESDP action data */
export interface ActionParam {
    readonly type: string;
    readonly name: string;
    readonly ids?: string;
}

/** An action item from IESDP action YAML data */
export interface ActionItem {
    readonly n: number;
    readonly name: string;
    readonly bg2?: number;
    readonly bgee?: number;
    readonly alias?: number | boolean;
    readonly desc?: string;
    readonly params?: readonly ActionParam[];
    readonly no_result?: boolean;
    readonly unknown?: boolean;
}

/** A game entry from IESDP games.yml */
export interface IESDPGame {
    readonly name: string;
    readonly ids: string;
    readonly "2da": string;
    readonly actions: string;
}

/** An item type entry from IESDP item_types.yml (code is a hex string like "0x00") */
export interface ItemTypeRaw {
    readonly type: string;
    readonly code: string;
    readonly id?: string;
}

/** A processed item type with generated id */
export interface ItemType {
    readonly id: string;
    readonly desc: string;
    /** Hex string from source YAML (e.g. "0x01"), kept as-is for output compatibility */
    readonly value: string;
}

/** An opcode entry parsed from IESDP opcode HTML frontmatter */
export interface OpcodeEntry {
    readonly n: number;
    readonly bg2: number;
    readonly opname: string;
}

/** Processed IESDP data, categorized by offset type */
export interface ProcessedIESDPData {
    readonly chars: readonly CompletionItem[];
    readonly lbytes: readonly CompletionItem[];
    readonly words: readonly CompletionItem[];
    readonly dwords: readonly CompletionItem[];
    readonly resrefs: readonly CompletionItem[];
    readonly strrefs: readonly CompletionItem[];
    readonly other: readonly CompletionItem[];
}

/** IElib function parameter */
export interface FuncParam {
    readonly name: string;
    readonly desc: string;
    readonly type: string;
    readonly required?: number;
    /** Default value - may be string or number in YAML data */
    readonly default?: string | number;
}

/** IElib function return value */
export interface FuncReturn {
    readonly name: string;
    readonly desc: string;
    readonly type: string;
}

/** IElib function data from YAML */
export interface FuncData {
    readonly name: string;
    readonly type: string;
    readonly desc: string;
    readonly int_params?: readonly FuncParam[];
    readonly string_params?: readonly FuncParam[];
    readonly return?: readonly FuncReturn[];
    readonly defaults?: Record<string, string>;
}

/** IElib type entry */
export interface TypeEntry {
    readonly name: string;
}

/** VSCode completion item kind constants matching the Python values */
export const COMPLETION_TYPE_CONSTANT = 21;
export const COMPLETION_TYPE_FUNCTION = 3;
