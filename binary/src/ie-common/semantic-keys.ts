/**
 * Semantic field-key mapping shared by the ITM and SPL format adapters, whose
 * display trees have the same Header / Abilities / Effects shape - only the
 * format id and the header-section label differ.
 *
 * EFF (Header / Body) and CRE have different display-tree shapes and keep their
 * own mappings in their format-adapter.ts.
 */

import { slugify } from "../snapshot-common";

export function abilityEffectsSemanticFieldKey(
    formatId: string,
    headerLabel: string,
    segments: readonly string[],
): string | undefined {
    if (segments.length === 0) return undefined;
    const [first, second, third] = segments;

    if (first === headerLabel) {
        return `${formatId}.header.${slugify(second ?? "")}`;
    }
    if (first === "Abilities") {
        return third ? `${formatId}.abilities[].${slugify(third)}` : `${formatId}.abilities[]`;
    }
    if (first === "Effects") {
        return third ? `${formatId}.effects[].${slugify(third)}` : `${formatId}.effects[]`;
    }
    return `${formatId}.${segments.map((s) => slugify(s)).join(".")}`;
}
