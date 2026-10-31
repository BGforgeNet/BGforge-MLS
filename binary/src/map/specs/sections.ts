import { i32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

/**
 * The MAP section structure around the per-record specs: the count words the parser reads between records, and
 * the labels of the groups that hold records. The parser emits every one of these labels from here and every
 * reader of the display tree (canonical reader, boundary scoring, editor projection) finds it from here, by key,
 * so relabelling one is a single edit. All words are big-endian int32, as everywhere in a MAP.
 */

/** The total object count leading the objects section. */
export const objectsSectionSpec = {
    totalObjects: { codec: i32 },
} satisfies Record<string, FieldSpec>;

/** The object count leading each elevation's object list. */
export const elevationObjectsSpec = {
    objectCount: { codec: i32 },
} satisfies Record<string, FieldSpec>;

/** The script count leading each script list. */
export const scriptListSpec = {
    scriptCount: { codec: i32 },
} satisfies Record<string, FieldSpec>;

/** Slots per script extent: every extent stores this many, used or not. */
export const SCRIPT_EXTENT_SLOTS = 16;

/** The two words trailing each extent of script slots. */
export const scriptExtentSpec = {
    extentLength: { codec: i32 },
    extentNext: { codec: i32 },
} satisfies Record<string, FieldSpec>;

/** The quantity word ahead of each inventory entry's object record. */
export const inventoryEntrySpec = {
    quantity: { codec: i32 },
} satisfies Record<string, FieldSpec>;

export const objectsSectionPresentation: StructPresentation<SpecData<typeof objectsSectionSpec>> = {};
export const elevationObjectsPresentation: StructPresentation<SpecData<typeof elevationObjectsSpec>> = {};
export const scriptListPresentation: StructPresentation<SpecData<typeof scriptListSpec>> = {};
export const scriptExtentPresentation: StructPresentation<SpecData<typeof scriptExtentSpec>> = {};
export const inventoryEntryPresentation: StructPresentation<SpecData<typeof inventoryEntrySpec>> = {};

const SCRIPT_LIST_SUFFIX = " Scripts";

/**
 * Labels of the groups that hold records. The indexed groups run from 0 in file order, which is how
 * `indexedChildGroups` in `parse-helpers.ts` finds them again.
 */
export const mapGroupLabels = {
    objectsSection: "Objects Section",
    elevationObjects: (elevation: number): string => `Elevation ${elevation} Objects`,
    scriptList: (typeName: string): string => `${typeName}${SCRIPT_LIST_SUFFIX}`,
    /** Whether `name` labels a script list, of any type: an unknown one is named after its number. */
    isScriptList: (name: string): boolean => name.endsWith(SCRIPT_LIST_SUFFIX),
    /** The type name a script list's label carries; `name` is one `isScriptList` accepts. */
    scriptListType: (name: string): string => name.slice(0, -SCRIPT_LIST_SUFFIX.length),
    extent: (index: number): string => `Extent ${index}`,
    slot: (index: number): string => `Slot ${index}`,
    /** What each of a slot's field labels starts with, then a space: `index` counts slots across the list. */
    slotEntry: (index: number): string => `Entry ${index}`,
    /** A decoded object: `path` is its elevation and index, then an inventory index per nesting level. */
    object: (path: string, typeName: string): string => `${mapGroupLabels.objectPrefix(path)}${typeName})`,
    /** What every decoded object's label at `path` starts with; an object the parser stopped inside lacks it. */
    objectPrefix: (path: string): string => `Object ${path} (`,
    /** An object the parser stopped inside, before its type was known. */
    incompleteObject: (path: string): string => `Object ${path}`,
    inventoryEntry: (index: number): string => `Inventory Entry ${index}`,
} as const;
