/**
 * ITM/SPL "abilities + effects" tree projection (ROUGH first cut).
 *
 * ITM and SPL store a single flat `effects[]` array partitioned by owner: the header owns a leading
 * range (the equipping / casting "global" effects) and each ability owns a contiguous slice after it
 * (see `binary/src/ie-common/effect-partition.ts`). The flat Effects list throws that ownership away.
 * This projection rebuilds it as a two-level tree - Global group + one group per ability, each carrying
 * its effect nodes - so the webview can render effects nested under the ability they belong to.
 *
 * Like `projectSpellbook`, it runs host-side and reads the live display-tree model (so it reflects edits
 * without depending on a possibly-stale canonical document). Ownership uses first-owner-wins over the
 * range fields, mirroring `createEffectPartition().effectOwners`; any effect owned by no range falls into
 * `unassigned` (the spellbook's bucket equivalent).
 */

import type { Model } from "./model";
import type { NodeId } from "./types";
import { childGroups, fieldNumber, fieldsByKey, findGroup, normKey } from "./relationship/model-helpers";

/** Per-format range-field keys. Source of truth: `ITM_FIELDS` / `SPL_FIELDS` in `binary/src/{itm,spl}/entity-ops.ts`
 *  (not barrel-exported, so duplicated here as plain strings - keep in sync if those bindings change). Matched
 *  against the model via `normKey`, so capitalization/spacing of the humanized display label does not matter. */
const RANGE_FIELDS: Readonly<
    Record<string, { headerStart: string; headerCount: string; abilityStart: string; abilityCount: string }>
> = {
    itm: {
        headerStart: "featureBlocksIndex",
        headerCount: "featureBlocksCount",
        abilityStart: "featureBlockIndex",
        abilityCount: "featureBlockCount",
    },
    spl: {
        headerStart: "castingFeatureBlocksIndex",
        headerCount: "castingFeatureBlocksCount",
        abilityStart: "featureBlocksOffset",
        abilityCount: "featureBlocksCount",
    },
};

/** Display name of the leading "global" group, per format. */
const GLOBAL_LABEL: Readonly<Record<string, string>> = { itm: "Global (Equipping)", spl: "Global (Casting)" };

/** Per-format ability field surfaced on the ability row as a level badge. SPL extended headers carry a
 *  "Level Required" (minimum caster level); ITM extended headers carry no level field, so none is shown. */
const ABILITY_LEVEL_FIELD: Readonly<Record<string, string>> = { spl: "levelRequired" };

export interface EffectTreeEntry {
    readonly nodeId: NodeId;
    readonly label: string;
    /** The effect's 0-based index in the flat effects array - drives reorder up/down enablement. */
    readonly index: number;
}

export interface EffectTreeGroup {
    /** Stable key for collapse state: "global" or "ability:<index>". */
    readonly key: string;
    readonly label: string;
    /** The ability group node - present for ability groups (selecting it edits the ability's own fields,
     *  and it is the entry id for owner-scoped ops), absent for the global group. */
    readonly abilityNodeId?: NodeId;
    /** The ability's 0-based index among abilities - drives reorder up/down enablement; undefined for global. */
    readonly index?: number;
    /** The ability's required level, shown as a badge on the row (SPL "Level Required"); undefined for the
     *  global group and for formats whose abilities carry no level field (ITM). */
    readonly levelRequired?: number;
    readonly effects: readonly EffectTreeEntry[];
}

export interface EffectTreeView {
    readonly groups: readonly EffectTreeGroup[];
    /** Effects owned by no range (orphans) - rendered in a trailing bucket so nothing is dropped. */
    readonly unassigned: readonly EffectTreeEntry[];
    /** True when the format is not an ITM/SPL ability+effects record (nothing to project). */
    readonly empty: boolean;
    /** Counts + the section node ids, so the renderer can drive structure ops: reorder enablement, the
     *  section-level "add ability" (abilitiesNodeId), and "add global effect" (effectsNodeId - a section-level
     *  effect add appends to the equipping/casting range). undefined when the format lacks that group. */
    readonly abilityCount: number;
    readonly effectCount: number;
    readonly abilitiesNodeId?: NodeId;
    readonly effectsNodeId?: NodeId;
}

const EMPTY: EffectTreeView = { groups: [], unassigned: [], empty: true, abilityCount: 0, effectCount: 0 };

/** A short, informative effect label: the effect node name plus its opcode number (e.g. "Effect 3 - op 12"). */
function effectLabel(model: Model, effectNode: { id: NodeId; name: string }): string {
    const fields = fieldsByKey(model, model.nodes[model.byId.get(effectNode.id)!]!);
    const opcode = fields.get("opcode");
    const code = opcode ? fieldNumber(opcode) : undefined;
    return code === undefined ? effectNode.name : `${effectNode.name} - op ${code}`;
}

function readRange(
    model: Model,
    group: ReturnType<typeof findGroup>,
    startKey: string,
    countKey: string,
): { start: number; count: number } {
    if (!group) return { start: 0, count: 0 };
    const fields = fieldsByKey(model, group);
    const start = fields.get(normKey(startKey));
    const count = fields.get(normKey(countKey));
    return { start: (start && fieldNumber(start)) ?? 0, count: (count && fieldNumber(count)) ?? 0 };
}

export function projectEffectTree(model: Model): EffectTreeView {
    const format = model.parseResult.format;
    const fields = RANGE_FIELDS[format];
    if (!fields) return EMPTY;

    const abilitiesGroup = findGroup(model, "Abilities");
    const effectsGroup = findGroup(model, "Effects");
    if (!effectsGroup) return EMPTY;

    const effectNodes = childGroups(model, effectsGroup);
    const abilityNodes = abilitiesGroup ? childGroups(model, abilitiesGroup) : [];
    const headerGroup = model.nodes.find((n) => n.kind === "group" && n.name.endsWith("Header"));

    const entries: EffectTreeEntry[] = effectNodes.map((n, i) => ({
        nodeId: n.id,
        label: effectLabel(model, n),
        index: i,
    }));
    const owner = Array.from<string | undefined>({ length: entries.length });

    // First-owner-wins range fill (mirrors createEffectPartition().effectOwners): equipping range first,
    // then abilities in order; an index already claimed is not reclaimed.
    const claim = (key: string, start: number, count: number): void => {
        for (let i = start; i < start + count; i++) {
            if (i >= 0 && i < owner.length && owner[i] === undefined) owner[i] = key;
        }
    };
    const global = readRange(model, headerGroup, fields.headerStart, fields.headerCount);
    claim("global", global.start, global.count);
    const abilityRanges = abilityNodes.map((a) => readRange(model, a, fields.abilityStart, fields.abilityCount));
    abilityRanges.forEach((r, i) => claim(`ability:${i}`, r.start, r.count));

    const effectsFor = (key: string): EffectTreeEntry[] => entries.filter((_, i) => owner[i] === key);

    // Per-format ability level badge (SPL "Level Required"; none for ITM).
    const levelKey = ABILITY_LEVEL_FIELD[format];
    const abilityLevel = (a: (typeof abilityNodes)[number]): number | undefined => {
        if (!levelKey) return undefined;
        const f = fieldsByKey(model, a).get(normKey(levelKey));
        return f ? fieldNumber(f) : undefined;
    };

    const groups: EffectTreeGroup[] = [
        { key: "global", label: GLOBAL_LABEL[format] ?? "Global", effects: effectsFor("global") },
        ...abilityNodes.map((a, i) => ({
            key: `ability:${i}`,
            label: `Ability ${i + 1}`,
            abilityNodeId: a.id,
            index: i,
            levelRequired: abilityLevel(a),
            effects: effectsFor(`ability:${i}`),
        })),
    ];
    const unassigned = entries.filter((_, i) => owner[i] === undefined);

    return {
        groups,
        unassigned,
        empty: false,
        abilityCount: abilityNodes.length,
        effectCount: entries.length,
        abilitiesNodeId: abilitiesGroup?.id,
        effectsNodeId: effectsGroup.id,
    };
}
