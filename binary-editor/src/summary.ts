/**
 * Per-format summary registry for list-section entry groups.
 *
 * The webview renders a `row.summary` string alongside the positional name
 * ("Effect 1", "Ability 1") so the user can see what each entry IS at a
 * glance without expanding it. A summary is produced by projecting one key
 * child field and using its resolved displayValue (e.g. the opcode name for
 * an IE effect, the ability form for a spell ability).
 *
 * Design: a declarative table maps (formatId, sectionName) -> fieldName.
 * The generic resolution walks the model tree - no per-format code branches.
 * Returns undefined when the field is absent, preserving the positional
 * fallback name; never throws.
 */

import type { FlatNode, Model } from "./model";
import type { RelationshipModel } from "./relationship/types";
import { enumSelectedLabel, enumHexDigits } from "../../shared/enum-label";
import { projectRow } from "./window";

/** Computes a one-line display summary for a list-section group entry. */
export type SummaryComposer = (node: FlatNode, model: Model, rel?: RelationshipModel) => string | undefined;

// ---------------------------------------------------------------------------
// Registry table
// ---------------------------------------------------------------------------

/**
 * Describes which child field name to read for each list-section entry type.
 * `sectionName` is the exact display-tree name of the parent group node
 * (e.g. "Effects", "Abilities"). `fieldName` is the exact humanized field
 * label as emitted by walkStruct (camelCase -> Title Case, with any
 * presentation.label overrides applied).
 */
interface SectionSummarySpec {
    readonly sectionName: string;
    readonly fieldName: string;
}

interface FormatSummarySpec {
    readonly sections: readonly SectionSummarySpec[];
}

/**
 * Per-format summary specs. Field names are taken from real projected output
 * (see inspection of bgsleepp.spl, illas03.itm, misc8j.itm):
 *
 * SPL effects:   "Effects" section, child "Opcode" (humanize("opcode") = "Opcode";
 *                with rel the displayValue resolves to the opcode label string).
 * SPL abilities: "Abilities" section, child "Form" (humanize("form") = "Form";
 *                enum values e.g. "Standard", "Projectile").
 * ITM effects:   same "Effects"/"Opcode" shape as SPL (shared ie-common spec).
 * ITM abilities: "Abilities" section, child "Attack Type"
 *                (humanize("attackType") = "Attack Type"; enum e.g. "Ranged", "Melee").
 *
 * The registry covers the formats that render master-detail list sections
 * with a meaningful key field: spl, itm, and cre. EFF is a single flat
 * header+body record (form sections only, no list section), so it has no
 * entry.
 *
 * CRE list sections (field names are the humanized walkStruct labels):
 *   - Known Spells / Memorized Spells -> the spell resref ("Spell").
 *   - Effects -> the opcode ("Opcode"; resolved to a label for v2, raw for v1
 *     which carries no opcode enum).
 *   - Items -> the item resref ("Item").
 *   - Spell Memorization Info -> the priest/wizard/innate class ("Spell Type").
 */
const FORMAT_SPECS: Readonly<Record<string, FormatSummarySpec>> = {
    spl: {
        sections: [
            { sectionName: "Effects", fieldName: "Opcode" },
            { sectionName: "Abilities", fieldName: "Form" },
        ],
    },
    itm: {
        sections: [
            { sectionName: "Effects", fieldName: "Opcode" },
            { sectionName: "Abilities", fieldName: "Attack Type" },
        ],
    },
    cre: {
        sections: [
            { sectionName: "Known Spells", fieldName: "Spell" },
            { sectionName: "Memorized Spells", fieldName: "Spell" },
            { sectionName: "Effects", fieldName: "Opcode" },
            { sectionName: "Items", fieldName: "Item" },
            { sectionName: "Spell Memorization Info", fieldName: "Spell Type" },
        ],
    },
    // MAP object entries use a dedicated composer (objectEntrySummary): PID + type + decoded subtype, beyond
    // what the single-field table can express. The three elevation sections are lifted to depth 0 by MAP's
    // projectDisplayRoot.
};

// ---------------------------------------------------------------------------
// Generic resolution
// ---------------------------------------------------------------------------

/**
 * Find the spec entry matching the given node's parent section name, if any.
 * The node's parentId is looked up in the model to retrieve its name.
 */
function findSpec(node: FlatNode, model: Model, specs: readonly SectionSummarySpec[]): SectionSummarySpec | undefined {
    if (node.parentId === undefined) return undefined;
    const parentIdx = model.byId.get(node.parentId);
    if (parentIdx === undefined) return undefined;
    const parent = model.nodes[parentIdx];
    if (!parent) return undefined;
    return specs.find((s) => s.sectionName === parent.name);
}

/**
 * Project a named child field of `node` and return its summary text.
 * An enum field is value-prefixed ("<value> <name>") so the list entry reads the same way as its dropdown
 * (the opcode/form/attack-type names the user picks from); a non-enum field (a resref string, a raw number)
 * keeps its plain displayValue. Returns undefined when the field is absent (robust fallback path).
 */
function resolveFieldSummary(
    node: FlatNode,
    model: Model,
    fieldName: string,
    rel: RelationshipModel | undefined,
): string | undefined {
    const childIndices = model.childrenByParent.get(node.id) ?? [];
    for (const idx of childIndices) {
        const child = model.nodes[idx];
        if (child?.kind === "field" && child.name === fieldName) {
            const row = projectRow(model, child, rel);
            if (row.valueType === "enum" && typeof row.rawValue === "number") {
                return enumSelectedLabel(row.rawValue, row.enumOptions, enumHexDigits(row.numericFormat, row.size));
            }
            return row.displayValue;
        }
    }
    return undefined;
}

/**
 * Build a SummaryComposer for the given format spec. The returned function:
 * - Identifies which section spec applies by looking up the node's parent name.
 * - Projects the keyed child field (with rel for enum resolution).
 * - Returns undefined on any miss (absent parent, absent field, empty value).
 * - Never throws.
 */
function makeComposer(spec: FormatSummarySpec): SummaryComposer {
    return (node, model, rel): string | undefined => {
        if (node.kind !== "group") return;
        const section = findSpec(node, model, spec.sections);
        if (!section) return;
        try {
            const value = resolveFieldSummary(node, model, section.fieldName, rel);
            // Treat empty-string values as absent so the positional name shows through.
            return value && value.length > 0 ? value : undefined;
        } catch {
            // Swallow unexpected errors; fall through to the undefined return below.
        }
        return undefined;
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * MAP inventory-entry summary. The "Inventory Entry N" groups sit under an object group (whose name varies),
 * so the section-name table cannot key them; compose directly instead, so the inventory mini-list rows read as
 * items rather than positional placeholders. Uses the nested item-object's PID (its "what is it" identity, no
 * external proto-name resolver available) and the entry's quantity, e.g. "0x0500000c x2".
 */
function inventoryEntrySummary(node: FlatNode, model: Model, rel: RelationshipModel | undefined): string | undefined {
    if (node.kind !== "group" || !node.name.startsWith("Inventory Entry")) return undefined;
    const children = (model.childrenByParent.get(node.id) ?? []).map((i) => model.nodes[i]!);
    const qtyNode = children.find((c) => c?.kind === "field" && c.name === "Quantity");
    const objNode = children.find((c) => c?.kind === "group" && c.name.startsWith("Object "));
    const qty = qtyNode ? projectRow(model, qtyNode, rel).displayValue : undefined;
    let item: string | undefined;
    if (objNode) {
        const pidNode = (model.childrenByParent.get(objNode.id) ?? [])
            .map((i) => model.nodes[i]!)
            .find((c) => c?.kind === "field" && c.name === "PID");
        item = pidNode ? projectRow(model, pidNode, rel).displayValue : objNode.name;
    }
    const segments: string[] = [];
    if (item) segments.push(item);
    if (qty !== undefined) segments.push(`x${qty}`);
    return segments.length > 0 ? segments.join(" ") : undefined;
}

/**
 * MAP elevation-object summary: the object's PID (its proto identity, no external proto-name resolver needed)
 * plus its type and, for item/scenery objects, the decoded subtype - e.g. "0x0200014d Scenery / Door",
 * "0x0500000c Misc". The type is the bracketed label in the object group's own name (objectTypeName); the
 * subtype is the nested read-only "Sub Type" under "Subtype Data" (absent for misc/critter and undecoded
 * objects, which then read as just PID + type). PID-first keeps the master list left-aligned.
 */
function objectEntrySummary(node: FlatNode, model: Model, rel: RelationshipModel | undefined): string | undefined {
    if (node.kind !== "group" || node.parentId === undefined) return undefined;
    const parentIdx = model.byId.get(node.parentId);
    const parent = parentIdx !== undefined ? model.nodes[parentIdx] : undefined;
    if (!parent || !/^Elevation \d+ Objects$/.test(parent.name ?? "")) return undefined;

    const children = (model.childrenByParent.get(node.id) ?? []).map((i) => model.nodes[i]!);
    const pidNode = children.find((c) => c?.kind === "field" && c.name === "PID");
    const pid = pidNode ? projectRow(model, pidNode, rel).displayValue : undefined;

    const type = node.name.match(/\(([^)]+)\)\s*$/)?.[1];

    const subtypeGroup = children.find((c) => c?.kind === "group" && c.name === "Subtype Data");
    const subTypeNode = subtypeGroup
        ? (model.childrenByParent.get(subtypeGroup.id) ?? [])
              .map((i) => model.nodes[i]!)
              .find((c) => c?.kind === "field" && c.name === "Sub Type")
        : undefined;
    const subType = subTypeNode ? projectRow(model, subTypeNode, rel).displayValue : undefined;

    const typeStr = [type, subType].filter((s) => s !== undefined && s !== "").join(" / ");
    const parts = [pid, typeStr].filter((s): s is string => typeof s === "string" && s.length > 0);
    return parts.length > 0 ? parts.join(" ") : undefined;
}

// Pre-built composers, one per format. MAP also composes inventory-entry rows (handled before the table).
const BASE_COMPOSERS: Readonly<Record<string, SummaryComposer>> = Object.fromEntries(
    Object.entries(FORMAT_SPECS).map(([id, spec]) => [id, makeComposer(spec)]),
);
const COMPOSERS: Readonly<Record<string, SummaryComposer>> = {
    ...BASE_COMPOSERS,
    map: (node, model, rel) => inventoryEntrySummary(node, model, rel) ?? objectEntrySummary(node, model, rel),
};

/**
 * Return the summary composer for the given format id, or undefined when no
 * summary spec is registered. The composer accepts a group node and returns
 * its meaningful one-line summary, or undefined when the key field is absent.
 */
export function summaryComposerFor(formatId: string): SummaryComposer | undefined {
    return COMPOSERS[formatId];
}
