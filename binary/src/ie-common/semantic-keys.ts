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
        // A header sub-group leaf (e.g. ITM "Usability Flags" -> its four per-byte flag fields) keeps the
        // leaf in the key so each byte gets a distinct semantic key instead of all collapsing to the group's.
        return third
            ? `${formatId}.header.${slugify(second ?? "")}.${slugify(third)}`
            : `${formatId}.header.${slugify(second ?? "")}`;
    }
    if (first === "Abilities" || first === "Effects") {
        const section = first === "Abilities" ? "abilities" : "effects";
        if (!third) return `${formatId}.${section}[]`;
        // Keep every segment past the entry (`third` and any deeper leaf) so a nested slot-array - e.g. the ITM
        // ability `Melee Animation` group's Overhand/Backhand/Thrust slots - gets a distinct key per slot rather
        // than all three collapsing to the group's key (which a flat per-entry detail map could not tell apart).
        const leaf = segments
            .slice(2)
            .map((s) => slugify(s))
            .join(".");
        return `${formatId}.${section}[].${leaf}`;
    }
    return `${formatId}.${segments.map((s) => slugify(s)).join(".")}`;
}
