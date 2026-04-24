/**
 * Re-exports all ie/ module public APIs.
 * Serves the same role as the Python ie/__init__.py with wildcard imports.
 */

export { opcodeNameToId } from "./opcodes.ts";

export {
    getOffsetPrefix,
    getFormatVersion,
    getOffsetId,
    stringToId,
    getOffsetSize,
    validateOffset,
    offsetIsUnused,
    offsetsToDefinition,
} from "./offsets.ts";

export { getItemTypes, saveItemTypesIelib, getItemTypesIsense } from "./item-types.ts";

export { actionAliasDesc, actionDesc, actionDescAbsoluteUrls, appendUnique, actionDetail } from "./actions.ts";

export { extractTriggersFromHtml } from "./triggers.ts";

export {
    createItemsSeq,
    dumpCompletion,
    dumpHighlight,
    dumpDefinition,
    stripLiquid,
    checkCompletion,
} from "./common.ts";

export { cmpStr, litscal, findFiles } from "../../../utils/src/yaml-helpers.ts";

export type {
    CompletionItem,
    IEDataEntry,
    IEData,
    OffsetItem,
    ActionItem,
    ActionParam,
    IESDPGame,
    ItemType,
    ItemTypeRaw,
    OpcodeEntry,
    ProcessedIESDPData,
    FuncData,
    FuncParam,
    FuncReturn,
    TypeEntry,
} from "./types.ts";

export { COMPLETION_TYPE_CONSTANT, COMPLETION_TYPE_FUNCTION } from "./types.ts";

export {
    validateActionItem,
    validateArray,
    validateFuncData,
    validateIESDPGame,
    validateItemTypeRaw,
    validateOffsetItem,
    validateTypeEntry,
} from "./validate.ts";
