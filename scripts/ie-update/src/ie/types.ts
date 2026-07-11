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

/** VSCode completion item kind constants matching the Python values */
export const COMPLETION_TYPE_CONSTANT = 21;
export const COMPLETION_TYPE_FUNCTION = 3;
