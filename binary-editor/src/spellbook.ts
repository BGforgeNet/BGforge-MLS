/**
 * Unified CRE spellbook projection.
 *
 * CRE stores spellcasting across three tables joined by positional index ranges: Known Spells (the
 * spellbook), Spell Memorization Info (per level/type: slot capacity + a [firstIndex, count) slice into the
 * memorized table), and Memorized Spells (the flat prepared-slot array). The editor presents these as one
 * view organized by spell type -> level. This module is the pure read-side join that produces that view from
 * the model; it runs host-side (like the cross-record diagnostics) and ships a structured `SpellbookView` to
 * the webview renderer.
 *
 * The join is a TOTAL function over arbitrary on-disk data - the tables can be internally inconsistent (a
 * range out of bounds, two ranges overlapping, a memorized entry owned by no range, duplicate level/type
 * rows) and the view must render all of it losslessly without throwing. The invariant:
 *
 *   A level panel shows exactly the memorized entries UNIQUELY and IN-BOUNDS owned by its range. Every
 *   memorized entry that is not cleanly placed (owned by zero ranges = orphan, or by more than one =
 *   contested) goes to the bucket. A range that overruns / points out of bounds, or a level/type carried by
 *   more than one Mem-Info row, is flagged - the renderer gates structural edits on flagged levels.
 *
 * Spell levels are stored 0-based in both Known and Mem-Info, so they join on the raw value directly; the
 * view exposes the raw level and the renderer displays `level + 1`.
 */

import type { Model } from "./model";
import type { Diagnostic, NodeId } from "./types";
import { childGroups, fieldNumber, fieldsByKey, fieldText, findGroup, normKey } from "./relationship/model-helpers";

const KNOWN_SECTION = "Known Spells";
const MEMINFO_SECTION = "Spell Memorization Info";
const MEMORIZED_SECTION = "Memorized Spells";

const K = {
    spell: normKey("Spell"),
    spellLevel: normKey("Spell Level"),
    spellType: normKey("Spell Type"),
    numMemorizable: normKey("Num Memorizable"),
    numMemorizableEffective: normKey("Num Memorizable Effective"),
    firstIndex: normKey("First Memorized Spell Index"),
    count: normKey("Memorized Spell Count"),
    flags: normKey("Memorized Flags"),
} as const;

/** Spell-type code -> display name; mirrors CreSpellType. Unknown codes render as `Type N` (never dropped). */
const SPELL_TYPE_NAMES: Readonly<Record<number, string>> = { 0: "Priest", 1: "Wizard", 2: "Innate" };
function spellTypeName(type: number): string {
    return SPELL_TYPE_NAMES[type] ?? `Type ${type}`;
}

/** A known spell at a given (type, level): a spellbook entry. */
export interface SpellbookKnown {
    readonly nodeId: NodeId; // the Known Spell group node (remove/move target)
    readonly resrefNodeId: NodeId; // the resref field node (edit target)
    readonly resref: string;
}

/** A memorized (prepared) spell slot owned by a level's range. */
export interface SpellbookSlot {
    readonly nodeId: NodeId; // the Memorized Spell group node
    readonly resrefNodeId: NodeId;
    readonly flagsNodeId: NodeId;
    readonly resref: string;
    readonly flags: number; // memorizedFlags bitfield: bit0 = Memorized, bit1 = Disabled
    readonly memorizedIndex: number; // flat index into the Memorized Spells table
}

/** One level panel: a single Mem-Info row (or a synthetic panel for a known-only level with no Mem-Info row). */
export interface SpellbookLevel {
    readonly type: number; // raw spell-type code
    readonly level: number; // raw (0-based) spell level
    /** The Mem-Info group node backing this panel; undefined for a synthetic known-only level. Slot-count
     *  edits and structural ops target it; a synthetic level offers "add memorization row" instead. */
    readonly ownerNodeId?: NodeId;
    readonly numMemorizable?: number;
    readonly numMemorizableEffective?: number;
    readonly numMemorizableNodeId?: NodeId;
    readonly numMemorizableEffectiveNodeId?: NodeId;
    readonly declaredCount: number; // memorizedSpellCount as stored (may exceed slots.length when flagged)
    readonly known: readonly SpellbookKnown[];
    readonly slots: readonly SpellbookSlot[]; // cleanly-owned memorized entries, in flat-index order
    /** True when this level's range is inconsistent (overrun/out-of-bounds) or its (type,level) is carried by
     *  more than one Mem-Info row. The renderer gates structural edits on it until the user normalizes. */
    readonly flagged: boolean;
    readonly flagReasons: readonly string[];
    /** Safe one-click normalize for an overrun/out-of-bounds range: set the memorized-spell count field to the
     *  value that makes the range fit (a plain field edit, no byte-structural change). Absent for clean rows
     *  and for overlap/duplicate flags (which have no unambiguous field-edit fix). */
    readonly clampCountFix?: { readonly nodeId: NodeId; readonly value: number };
}

export interface SpellbookTypeGroup {
    readonly type: number;
    readonly typeName: string;
    readonly levels: readonly SpellbookLevel[];
    /** Known spells / cleanly-owned memorized spells under this type, summed across its levels - the renderer
     *  shows them as a `known/memorized` badge on the type subtab. Bucketed (orphan/contested) memorized
     *  entries are not counted - they belong to no type. */
    readonly knownCount: number;
    readonly memorizedCount: number;
}

/** A memorized entry that is not cleanly placed under a single level. */
export interface SpellbookBucketEntry {
    readonly nodeId: NodeId;
    readonly resrefNodeId: NodeId;
    readonly flagsNodeId: NodeId;
    readonly resref: string;
    readonly flags: number;
    readonly memorizedIndex: number;
    readonly reason: "orphan" | "contested";
    /** For a contested entry, the display labels of the levels claiming it (e.g. "Wizard L3"). */
    readonly claimedBy?: readonly string[];
    /** For a contested entry, a one-click root-fix: clamp one claiming level's count to the slots it cleanly
     *  owns, which releases its claim on this shared entry (resolving the overlap at its source). Absent when no
     *  claiming level has a clamp (e.g. exact-duplicate ranges). Applied as a plain field edit via `onedit`. */
    readonly resolveFix?: { readonly nodeId: NodeId; readonly value: number; readonly levelLabel: string };
}

export interface SpellbookView {
    readonly types: readonly SpellbookTypeGroup[];
    readonly bucket: readonly SpellbookBucketEntry[];
    /** True only when the file has NONE of the three spell sections (a non-spell record). A CRE always carries
     *  the sections - even with zero entries - so for any creature this is false and the three type subtabs
     *  (Priest/Wizard/Innate) always render, making the first spell of an absent type reachable. */
    readonly empty: boolean;
}

interface MeminfoRow {
    readonly node: NodeId;
    readonly type: number;
    readonly level: number;
    readonly numMemorizable?: number;
    readonly numMemorizableEffective?: number;
    readonly numMemorizableNodeId?: NodeId;
    readonly numMemorizableEffectiveNodeId?: NodeId;
    readonly start: number;
    readonly count: number;
    readonly overrunOrOob: boolean;
    readonly countNodeId?: NodeId;
}

interface MemorizedEntry {
    readonly node: NodeId;
    readonly resrefNodeId: NodeId;
    readonly flagsNodeId: NodeId;
    readonly resref: string;
    readonly flags: number;
}

interface KnownEntry {
    readonly type: number;
    readonly level: number;
    readonly known: SpellbookKnown;
}

const levelLabel = (type: number, level: number): string => `${spellTypeName(type)} L${level + 1}`;

/** Read the Memorized Spells table into flat-indexed entries. Missing fields default to empty/0 (never throw). */
function readMemorized(model: Model): MemorizedEntry[] {
    const group = findGroup(model, MEMORIZED_SECTION);
    if (!group) return [];
    return childGroups(model, group).map((entry) => {
        const f = fieldsByKey(model, entry);
        const resrefNode = f.get(K.spell);
        const flagsNode = f.get(K.flags);
        return {
            node: entry.id,
            resrefNodeId: resrefNode?.id ?? entry.id,
            flagsNodeId: flagsNode?.id ?? entry.id,
            resref: (resrefNode && fieldText(resrefNode)) ?? "",
            flags: (flagsNode && fieldNumber(flagsNode)) ?? 0,
        };
    });
}

/** Read the Spell Memorization Info table into rows, marking ranges that overrun or point out of bounds. */
function readMeminfo(model: Model, memorizedLen: number): MeminfoRow[] {
    const group = findGroup(model, MEMINFO_SECTION);
    if (!group) return [];
    return childGroups(model, group).map((entry) => {
        const f = fieldsByKey(model, entry);
        const numMemNode = f.get(K.numMemorizable);
        const numEffNode = f.get(K.numMemorizableEffective);
        const countNode = f.get(K.count);
        const start = (f.get(K.firstIndex) && fieldNumber(f.get(K.firstIndex)!)) ?? 0;
        const count = (countNode && fieldNumber(countNode)) ?? 0;
        const overrunOrOob = count > 0 && (start < 0 || start + count > memorizedLen);
        return {
            node: entry.id,
            type: (f.get(K.spellType) && fieldNumber(f.get(K.spellType)!)) ?? 0,
            level: (f.get(K.spellLevel) && fieldNumber(f.get(K.spellLevel)!)) ?? 0,
            numMemorizable: numMemNode ? fieldNumber(numMemNode) : undefined,
            numMemorizableEffective: numEffNode ? fieldNumber(numEffNode) : undefined,
            numMemorizableNodeId: numMemNode?.id,
            numMemorizableEffectiveNodeId: numEffNode?.id,
            start,
            count,
            overrunOrOob,
            countNodeId: countNode?.id,
        };
    });
}

/** Read Known Spells into (type, level)-tagged entries. */
function readKnown(model: Model): KnownEntry[] {
    const group = findGroup(model, KNOWN_SECTION);
    if (!group) return [];
    return childGroups(model, group).map((entry) => {
        const f = fieldsByKey(model, entry);
        const resrefNode = f.get(K.spell);
        return {
            type: (f.get(K.spellType) && fieldNumber(f.get(K.spellType)!)) ?? 0,
            level: (f.get(K.spellLevel) && fieldNumber(f.get(K.spellLevel)!)) ?? 0,
            known: {
                nodeId: entry.id,
                resrefNodeId: resrefNode?.id ?? entry.id,
                resref: (resrefNode && fieldText(resrefNode)) ?? "",
            },
        };
    });
}

export function projectSpellbook(model: Model): SpellbookView {
    const memorized = readMemorized(model);
    const meminfo = readMeminfo(model, memorized.length);
    const known = readKnown(model);

    // `empty` keys on SECTION presence, not entry counts: a CRE with empty-but-present spell tables must still
    // render the three type subtabs (so the first spell of an absent type is reachable). Only a record that
    // carries none of the three sections is truly spell-less.
    const hasSpellSections =
        findGroup(model, KNOWN_SECTION) !== undefined ||
        findGroup(model, MEMINFO_SECTION) !== undefined ||
        findGroup(model, MEMORIZED_SECTION) !== undefined;
    if (!hasSpellSections) {
        return { types: [], bucket: [], empty: true };
    }

    // Coverage: for each memorized index, which Mem-Info rows claim it (in-bounds). One claim => clean owner;
    // zero => orphan; more than one => contested. Iterate rows in order so `claimers` is deterministic.
    const claimers: number[][] = memorized.map(() => []);
    meminfo.forEach((row, r) => {
        if (row.count <= 0) return;
        const lo = Math.max(0, row.start);
        const hi = Math.min(memorized.length, row.start + row.count);
        for (let k = lo; k < hi; k++) claimers[k]!.push(r);
    });

    const slotsByRow: SpellbookSlot[][] = meminfo.map(() => []);
    const overlapRows = new Set<number>(); // rows that share at least one memorized entry with another row
    // Bucket entries are collected with their claiming rows so a contested entry's resolveFix can reference one
    // claimer's clamp - which is only computable after every slot is distributed (slotsByRow below).
    const bucketTemp: (SpellbookBucketEntry & { claimerRows: number[] })[] = [];
    memorized.forEach((entry, k) => {
        const owners = claimers[k]!;
        const slot: SpellbookSlot = {
            nodeId: entry.node,
            resrefNodeId: entry.resrefNodeId,
            flagsNodeId: entry.flagsNodeId,
            resref: entry.resref,
            flags: entry.flags,
            memorizedIndex: k,
        };
        if (owners.length === 1) {
            slotsByRow[owners[0]!]!.push(slot);
        } else {
            if (owners.length > 1) for (const r of owners) overlapRows.add(r);
            bucketTemp.push({
                nodeId: entry.node,
                resrefNodeId: entry.resrefNodeId,
                flagsNodeId: entry.flagsNodeId,
                resref: entry.resref,
                flags: entry.flags,
                memorizedIndex: k,
                reason: owners.length === 0 ? "orphan" : "contested",
                claimerRows: owners,
                ...(owners.length > 1 && {
                    claimedBy: owners.map((r) => levelLabel(meminfo[r]!.type, meminfo[r]!.level)),
                }),
            });
        }
    });

    // A (type, level) carried by more than one Mem-Info row is itself an inconsistency (the memorization slices
    // should be one per level); flag every such row so its panel gates structural edits.
    const rowCountByKey = new Map<string, number>();
    for (const row of meminfo)
        rowCountByKey.set(`${row.type}:${row.level}`, (rowCountByKey.get(`${row.type}:${row.level}`) ?? 0) + 1);

    // Known spells grouped by (type, level); each group attaches to the FIRST Mem-Info panel of that key, or a
    // synthetic known-only panel when no Mem-Info row carries it.
    const knownByKey = new Map<string, SpellbookKnown[]>();
    for (const k of known) {
        const key = `${k.type}:${k.level}`;
        (knownByKey.get(key) ?? knownByKey.set(key, []).get(key)!).push(k.known);
    }
    const knownConsumed = new Set<string>();

    // Per-row clamp normalize: when a row overruns/over-bounds or overlaps another and declares more entries
    // than it cleanly owns, set its count to the cleanly-owned slot count - making it claim exactly its
    // contiguous in-bounds slots (removing the overrun and its share of any tail overlap). Computed once here so
    // both the level's clampCountFix and a contested bucket entry's resolveFix reference the same value.
    const clampByRow: ({ nodeId: NodeId; value: number } | undefined)[] = [];
    for (let r = 0; r < meminfo.length; r++) {
        const row = meminfo[r]!;
        const node = row.countNodeId;
        const clean = slotsByRow[r]!.length;
        clampByRow[r] =
            node !== undefined && (row.overrunOrOob || overlapRows.has(r)) && row.count !== clean
                ? { nodeId: node, value: clean }
                : undefined;
    }

    const levels: SpellbookLevel[] = meminfo.map((row, r) => {
        const key = `${row.type}:${row.level}`;
        const duplicate = (rowCountByKey.get(key) ?? 0) > 1;
        const flagReasons: string[] = [];
        if (row.overrunOrOob) flagReasons.push("memorization range overruns the memorized-spell table");
        if (overlapRows.has(r)) flagReasons.push("overlaps another memorization range");
        if (duplicate) flagReasons.push("more than one memorization row for this level");
        // Attach known spells to the first panel of this (type, level) only.
        let attachKnown: SpellbookKnown[] = [];
        if (!knownConsumed.has(key)) {
            attachKnown = knownByKey.get(key) ?? [];
            knownConsumed.add(key);
        }
        return {
            type: row.type,
            level: row.level,
            ownerNodeId: row.node,
            numMemorizable: row.numMemorizable,
            numMemorizableEffective: row.numMemorizableEffective,
            numMemorizableNodeId: row.numMemorizableNodeId,
            numMemorizableEffectiveNodeId: row.numMemorizableEffectiveNodeId,
            declaredCount: row.count,
            known: attachKnown,
            slots: slotsByRow[r]!,
            flagged: flagReasons.length > 0,
            flagReasons,
            ...(clampByRow[r] && { clampCountFix: clampByRow[r] }),
        };
    });

    // Synthetic panels for known-only (type, level) keys that no Mem-Info row carries.
    for (const [key, knownList] of knownByKey) {
        if (knownConsumed.has(key)) continue;
        const [type, level] = key.split(":").map(Number) as [number, number];
        levels.push({
            type,
            level,
            declaredCount: 0,
            known: knownList,
            slots: [],
            flagged: false,
            flagReasons: [],
        });
    }

    // Show every level faithfully - each physical Spell Memorization Info row (real files carry one per level,
    // including empty ones) plus any synthetic known-only level. Nothing is pruned: hiding empty physical rows
    // made them unreachable and let "add level" create a duplicate against the hidden row. Group by type.
    const byType = new Map<number, SpellbookLevel[]>();
    for (const l of levels) (byType.get(l.type) ?? byType.set(l.type, []).get(l.type)!).push(l);

    // Always surface the three canonical spell types (Priest/Wizard/Innate) as subtabs, even when empty, so the
    // first spell of an absent type is reachable; include any other type code present in the data too.
    const typeCodes = [...new Set<number>([0, 1, 2, ...byType.keys()])].sort((a, b) => a - b);
    const types: SpellbookTypeGroup[] = typeCodes.map((type) => {
        const ls = [...(byType.get(type) ?? [])].sort((a, b) => a.level - b.level);
        const knownCount = ls.reduce((n, l) => n + l.known.length, 0);
        const memorizedCount = ls.reduce((n, l) => n + l.slots.length, 0);
        return { type, typeName: spellTypeName(type), levels: ls, knownCount, memorizedCount };
    });

    // Finalize the bucket: a contested entry gets a resolveFix pointing at the first claiming row that has a
    // clamp - applying it releases that row's claim on the shared entry, resolving the overlap at its root.
    const bucket: SpellbookBucketEntry[] = bucketTemp.map(({ claimerRows, ...entry }) => {
        if (entry.reason !== "contested") return entry;
        const claimer = claimerRows.find((r) => clampByRow[r] !== undefined);
        if (claimer === undefined) return entry;
        const fix = clampByRow[claimer]!;
        return {
            ...entry,
            resolveFix: {
                nodeId: fix.nodeId,
                value: fix.value,
                levelLabel: levelLabel(meminfo[claimer]!.type, meminfo[claimer]!.level),
            },
        };
    });

    return { types, bucket, empty: false };
}

/**
 * File-level capacity diagnostics for the editor's diagnostics banner: one info note per level holding more
 * memorized spells than its effective slot capacity. This is informational, never a flag and never a block -
 * the file format stores the memorized count as a field independent of capacity, so an over-capacity level is
 * representable and editable. Derived from the same projection the column renders, so the banner and the inline
 * over-capacity marker always agree.
 */
export function spellbookCapacityDiagnostics(model: Model): Diagnostic[] {
    const diags: Diagnostic[] = [];
    for (const type of projectSpellbook(model).types) {
        for (const level of type.levels) {
            const eff = level.numMemorizableEffective;
            const nodeId = level.numMemorizableEffectiveNodeId ?? level.ownerNodeId;
            if (eff === undefined || nodeId === undefined || level.slots.length <= eff) continue;
            diags.push({
                nodeId,
                severity: "info",
                message: `${type.typeName} L${level.level + 1}: ${level.slots.length} memorized, ${eff} effective slots.`,
            });
        }
    }
    return diags;
}
