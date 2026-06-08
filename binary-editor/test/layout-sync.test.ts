/**
 * Layout/model SYNC guard. The declarative `FormatLayout` references fields and list sections by SEMANTIC
 * KEY (`toSemanticFieldKey(format, segments)` for fields; the depth-0 model group name for list sections).
 * `resolveLayout` binds those keys against the model the parser produces. A key the model never produces
 * (a typo, a namespace drift, a renamed section) does NOT error - it silently resolves to nothing and the
 * field/panel just vanishes from the editor. Before this test the only thing that caught that was the
 * manually-run Playwright screenshot harness; this turns the silent vanish into a red unit test.
 *
 * Three guarantees, against REAL parser output (vendored/committed fixtures, one per declared variant):
 *   A. Every field ref in every variant resolves to a model row (the bug class from the redesign).
 *   B. Completeness: every variant a shipped layout declares has a registered fixture - so adding a new
 *      variant without a fixture fails here instead of going silently unverified.
 *   C. Every declared list-section key resolves in at least one fixture (sections are optionally present
 *      per file, so this is a per-format union, not a per-fixture assertion).
 *
 * Fixture sourcing: committed fixtures (PRO protos, the ITM/MAP samples, the synthetic elevator) always
 * run; a missing committed fixture is a hard failure (a bad path). IE formats (SPL/EFF/CRE) and some PRO
 * subtypes only exist under `external/` (fetched by `pnpm test:external`); when absent those rows skip with
 * a logged warning rather than fail. `scenery.elevator` has no real fixture anywhere - Fallout elevators
 * are map-script driven, not an elevator-subtype scenery proto - so it uses a committed synthetic fixture
 * (see `fixtures/generate-scenery-elevator.mts`).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    type BinaryParser,
    creParser,
    effParser,
    formatAdapterRegistry,
    type FormatLayout,
    itmParser,
    type LayoutBlock,
    type LayoutVariant,
    mapParser,
    proParser,
    splParser,
    variantRows,
} from "@bgforge/binary";
import { buildModel } from "../src/model";
import { resolveLayout } from "../src/layout";

const REPO = path.resolve(__dirname, "../..");
const repo = (rel: string): string => path.join(REPO, rel);
const synthetic = (name: string): string => path.resolve(__dirname, "fixtures", name);

const PARSERS: Record<string, BinaryParser> = {
    pro: proParser,
    map: mapParser,
    itm: itmParser,
    spl: splParser,
    eff: effParser,
    cre: creParser,
};

/** One fixture per declared layout variant. `pro` has 17 (object types x item/scenery subtypes); the IE
 * formats and MAP have one each. Paths under `external/` are only present after `pnpm test:external`. */
const VARIANT_FIXTURES: { format: string; variant: string; file: string }[] = [
    { format: "pro", variant: "critter", file: repo("client/testFixture/proto/critters/00000029.pro") },
    {
        format: "pro",
        variant: "item.armor",
        file: repo("external/fallout/Fallout2_Restoration_Project/data/proto/items/00000524.pro"),
    },
    { format: "pro", variant: "item.weapon", file: repo("client/testFixture/proto/items/00000079.pro") },
    { format: "pro", variant: "item.ammo", file: repo("client/testFixture/proto/items/00000031.pro") },
    {
        format: "pro",
        variant: "item.container",
        file: repo("external/fallout/Fallout2_Restoration_Project/data/proto/items/00000577.pro"),
    },
    {
        format: "pro",
        variant: "item.drug",
        file: repo("external/fallout/Fallout2_Restoration_Project/data/proto/items/00000310.pro"),
    },
    {
        format: "pro",
        variant: "item.key",
        file: repo("external/fallout/Fallout2_Restoration_Project/data/proto/items/00000557.pro"),
    },
    { format: "pro", variant: "item.misc", file: repo("client/testFixture/proto/items/00000543.pro") },
    { format: "pro", variant: "scenery.door", file: repo("client/testFixture/proto/scenery/00000008.pro") },
    {
        format: "pro",
        variant: "scenery.stairs",
        file: repo("external/fallout/Fallout2_Restoration_Project/data/proto/scenery/00001888.pro"),
    },
    { format: "pro", variant: "scenery.elevator", file: synthetic("scenery-elevator.synthetic.pro") },
    {
        format: "pro",
        variant: "scenery.ladderTop",
        file: repo("external/fallout/Fallout2_Restoration_Project/data/proto/scenery/00001869.pro"),
    },
    {
        format: "pro",
        variant: "scenery.ladderBottom",
        file: repo("external/fallout/Fallout2_Restoration_Project/data/proto/scenery/00002250.pro"),
    },
    { format: "pro", variant: "scenery.generic", file: repo("client/testFixture/proto/scenery/00000109.pro") },
    { format: "pro", variant: "wall", file: repo("client/testFixture/proto/walls/00001531.pro") },
    { format: "pro", variant: "tile", file: repo("client/testFixture/proto/tiles/00000645.pro") },
    { format: "pro", variant: "misc", file: repo("client/testFixture/proto/misc/00000001.pro") },
    { format: "itm", variant: "item", file: repo("grammars/weidu-tp2/test/samples/core/items/misc8j.itm") },
    {
        format: "spl",
        variant: "spell",
        file: repo("external/infinity-engine/bg2-wildmage/wildmage/wild_spells/spl/wm_word.spl"),
    },
    {
        format: "eff",
        variant: "effect",
        file: repo("external/infinity-engine/Ascension/ascension/balthazar/resource/balth01b.eff"),
    },
    { format: "cre", variant: "creature", file: repo("external/infinity-engine/BGT-WeiDU/bgt/base/cre/bpimoen.cre") },
    { format: "map", variant: "map", file: repo("client/testFixture/maps/arcaves.map") },
];

/** Extra fixtures used ONLY to widen list-section coverage (guarantee C), not tied to a variant. The
 * committed town maps are single-elevation with no MVAR/spatial scripts; these two multi-elevation RP maps
 * collectively cover Local Variables, Elevation 1/2 Objects, and Spatial Scripts. */
const SECTION_FIXTURES: { format: string; file: string }[] = [
    { format: "map", file: repo("external/fallout/Fallout2_Restoration_Project/data/maps/arvill2.map") },
    { format: "map", file: repo("external/fallout/Fallout2_Restoration_Project/data/maps/sfchina2.map") },
];

const isExternal = (file: string): boolean => file.split(path.sep).includes("external");
const present = (file: string): boolean => fs.existsSync(file);

function blockRefs(block: LayoutBlock): { fields: string[]; sections: string[] } {
    switch (block.kind) {
        case "fields":
            // `joins` members are a subset of `fields`, so `fields` already covers them.
            return { fields: block.fields, sections: [] };
        case "group":
            // A boxed subgroup of fields (its `joins` members are a subset of its `fields`).
            return { fields: block.fields, sections: [] };
        case "flags":
            return { fields: [block.field], sections: [] };
        case "grid":
            return { fields: block.items, sections: [] };
        case "matrix":
            return { fields: block.groups.flatMap((g) => g.rows.flatMap((r) => Object.values(r.cells))), sections: [] };
        case "list":
            return { fields: [], sections: [block.sectionKey] };
        case "raw":
            return { fields: [], sections: [] };
    }
}

function variantRefs(variant: LayoutVariant): { fields: string[]; sections: string[] } {
    const fields: string[] = [];
    const sections: string[] = [];
    for (const row of variantRows(variant))
        for (const panel of row.panels)
            for (const block of panel.blocks) {
                const r = blockRefs(block);
                fields.push(...r.fields);
                sections.push(...r.sections);
            }
    return { fields, sections };
}

function layoutFor(format: string): FormatLayout {
    const layout = formatAdapterRegistry.get(format)?.layout;
    if (!layout) throw new Error(`format ${format} has no layout`);
    return layout;
}

// External fixtures absent (test:external not run) are skipped, not failed - logged here for visibility.
const skipped = VARIANT_FIXTURES.filter((f) => !present(f.file) && isExternal(f.file));
if (skipped.length > 0) {
    console.warn(
        `[layout-sync] ${skipped.length} external fixture(s) absent (run \`pnpm test:external\`); skipping: ` +
            skipped.map((f) => `${f.format}/${f.variant}`).join(", "),
    );
}
const runnable = VARIANT_FIXTURES.filter((f) => present(f.file) || !isExternal(f.file));

describe("layout/model sync", () => {
    // A. Every field ref in every (present) variant resolves against real parser output.
    it.each(runnable)("$format/$variant: every layout field ref resolves to a model row", (fx) => {
        const bytes = new Uint8Array(fs.readFileSync(fx.file)); // committed-missing throws here -> hard fail
        const parseResult = PARSERS[fx.format]!.parse(bytes);
        expect(parseResult.errors, `fixture parse errors: ${parseResult.errors?.join("; ")}`).toBeUndefined();
        expect(parseResult.variantId, "parser stamped an unexpected variant").toBe(fx.variant);

        const model = buildModel(parseResult);
        const resolved = resolveLayout(fx.format, layoutFor(fx.format), model);
        expect(resolved, "layout did not resolve for a stamped variant").toBeDefined();

        const { fields } = variantRefs(layoutFor(fx.format).variants[fx.variant]!);
        const unresolved = fields.filter((ref) => resolved!.fields[ref] === undefined);
        expect(unresolved, `${fx.format}/${fx.variant} has dangling field refs`).toEqual([]);
    });

    if (skipped.length > 0) {
        it.skip.each(skipped)("$format/$variant: skipped (external fixture absent)", () => {});
    }

    // B. Every declared variant has a registered fixture. Pure - always runs, independent of file presence.
    it("every declared layout variant has a registered fixture", () => {
        const registered = new Set(VARIANT_FIXTURES.map((f) => `${f.format}/${f.variant}`));
        const declared: string[] = [];
        for (const format of Object.keys(PARSERS))
            for (const variant of Object.keys(layoutFor(format).variants)) declared.push(`${format}/${variant}`);
        const unregistered = declared.filter((d) => !registered.has(d));
        expect(unregistered, "declared variants with no fixture in VARIANT_FIXTURES").toEqual([]);
    });

    // C. Every declared list-section key resolves in at least one fixture (per-format union). Skipped with
    // a log when any contributing fixture is absent, so a partial external checkout never false-fails.
    const formatsWithSections = Object.keys(PARSERS).filter((format) =>
        Object.values(layoutFor(format).variants).some((v) => variantRefs(v).sections.length > 0),
    );
    it.each(formatsWithSections)("%s: every declared list section resolves in some fixture", (format) => {
        const contributing = [
            ...VARIANT_FIXTURES.filter((f) => f.format === format),
            ...SECTION_FIXTURES.filter((f) => f.format === format),
        ];
        const missing = contributing.filter((f) => !present(f.file));
        if (missing.length > 0) {
            console.warn(
                `[layout-sync] skipping ${format} section coverage; absent fixtures: ` +
                    missing.map((f) => path.relative(REPO, f.file)).join(", "),
            );
            return; // external not fetched: cannot assert full union without false-failing
        }

        const declared = new Set<string>();
        for (const v of Object.values(layoutFor(format).variants))
            for (const s of variantRefs(v).sections) declared.add(s);

        const resolvedSections = new Set<string>();
        for (const fx of contributing) {
            const parseResult = PARSERS[format]!.parse(new Uint8Array(fs.readFileSync(fx.file)));
            const resolved = resolveLayout(format, layoutFor(format), buildModel(parseResult));
            for (const key of Object.keys(resolved?.sections ?? {})) resolvedSections.add(key);
        }

        const unresolved = [...declared].filter((s) => !resolvedSections.has(s));
        expect(unresolved, `${format} list-section keys that resolve in no fixture`).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------
// UX LABEL GUARDRAILS (issue classes B/C/D from the UX redesign). These assert label QUALITY against real
// resolved labels, not just resolution. A panel may opt out of the generic/redundant checks when its labels
// are intentionally numeric/opcode-dependent (e.g. EFF parameters), via GENERIC_OK.
// ---------------------------------------------------------------------------------------------------------

const STOPWORDS = new Set(["of", "the", "and", "or", "to", "vs", "a", "an", "per", "by", "id"]);
// Panels whose generic/numbered labels are intentional (opcode-dependent resrefs/params have no static name).
// cre Sound Slots stays here until the SNDSLOT.IDS event names are applied (then it must come off this list).
const GENERIC_OK = new Set<string>([
    "eff/effect/Parameters",
    "eff/effect/Resources",
    "cre/creature/Sound Slots",
    // Script-slot labels conventionally keep "Script" (bare "Class"/"Race"/"General" would collide with the
    // class/race/general fields in the same flat header struct, which the canonical rebuild matches by label).
    "cre/creature/Scripts and Dialogs",
    // Positional drug stat slots (each is a StatType dropdown); "Stat N" pairs with the "Amount N" effect rows.
    "pro/item.drug/Affected Stats",
    // Ordered OBJECT.IDS tuple with no per-slot meaning (positional, like sound slots).
    "cre/creature/Tracked Objects",
]);
// Truncations that must be spelled out (whole-word, case-insensitive). Genuine domain acronyms that stay
// (uppercased) are NOT here: PID (proto id), FRM, THAC0, EMP, AC, HP, DR.
const ABBREVIATIONS = new Set(["pts", "dmg", "crit", "desc", "ext", "coord", "num", "dest"]);
// Acronyms that must be upper-cased, flagged when they appear title-cased (exact case).
const MISCASED_ACRONYMS = new Set(["Id", "Ai", "Frm"]);

const labelWords = (label: string): string[] => label.split(/[^A-Za-z0-9%]+/).filter(Boolean);

interface PanelLabels {
    key: string;
    title: string;
    labels: string[];
}

/** Collect the rendered field/grid/matrix labels of every panel of every present variant. (Pre-tab: variants
 * have `rows`; revisit when the tab schema lands.) */
function collectPanelLabels(): PanelLabels[] {
    const out: PanelLabels[] = [];
    for (const fx of runnable) {
        const parseResult = PARSERS[fx.format]!.parse(new Uint8Array(fs.readFileSync(fx.file)));
        if (parseResult.errors || parseResult.variantId !== fx.variant) continue;
        const resolved = resolveLayout(fx.format, layoutFor(fx.format), buildModel(parseResult));
        if (!resolved) continue;
        for (const row of variantRows(layoutFor(fx.format).variants[fx.variant]!))
            for (const panel of row.panels) {
                const labels: string[] = [];
                for (const block of panel.blocks) {
                    if (block.kind === "fields" || block.kind === "grid") {
                        const refs = block.kind === "fields" ? block.fields : block.items;
                        for (const ref of refs) {
                            const r = resolved.fields[ref];
                            if (r) labels.push(r.name);
                        }
                    } else if (block.kind === "matrix") {
                        for (const g of block.groups) {
                            labels.push(g.label);
                            for (const r of g.rows) labels.push(r.label);
                        }
                        for (const c of block.valueColumns) labels.push(c.label);
                    }
                }
                out.push({ key: `${fx.format}/${fx.variant}/${panel.title ?? ""}`, title: panel.title ?? "", labels });
            }
    }
    return out;
}

describe("UX packing guardrails", () => {
    // F. A `fields` block with many entries must use >=2 columns, or it runs as one tall single column down a
    // wide page (the #7 waste). grid blocks carry an explicit `columns` (required by the schema); flags blocks
    // have a runtime bit count not visible here, so both are out of scope. Pure layout-structure check.
    it("no fields block with >20 entries is single-column", () => {
        const MAX_SINGLE_COLUMN = 20;
        const violations: string[] = [];
        for (const format of Object.keys(PARSERS))
            for (const [variant, v] of Object.entries(layoutFor(format).variants))
                for (const row of variantRows(v))
                    for (const panel of row.panels)
                        for (const block of panel.blocks)
                            if (
                                block.kind === "fields" &&
                                block.fields.length >= MAX_SINGLE_COLUMN &&
                                (block.columns ?? 1) < 2
                            )
                                violations.push(
                                    `${format}/${variant}/${panel.title ?? ""}: ${block.fields.length} fields, 1 column`,
                                );
        expect(
            violations,
            `single-column fields blocks that should be multi-column:\n${violations.join("\n")}`,
        ).toEqual([]);
    });

    // A. A variant with many panels must use tabs - otherwise it is the one-long-scroll mega-page (#14). Tabs
    // break it into per-page sections. Small variants (PRO item subtypes, EFF) may stay untabbed.
    it("a large variant uses tabs instead of one mega-page", () => {
        const PANEL_CAP = 10;
        const violations: string[] = [];
        for (const format of Object.keys(PARSERS))
            for (const [variant, v] of Object.entries(layoutFor(format).variants)) {
                const panelCount = variantRows(v).reduce((n, row) => n + row.panels.length, 0);
                if (panelCount > PANEL_CAP && v.rows !== undefined)
                    violations.push(`${format}/${variant}: ${panelCount} panels, untabbed`);
            }
        expect(violations, `large untabbed variants (should use tabs):\n${violations.join("\n")}`).toEqual([]);
    });
});

describe("PRO read-only discriminators", () => {
    // I. objectType selects the variant, so it must be SHOWN (every variant incl. critter) but READ-ONLY -
    // editing it would desync the stamped variant from the bytes. subType is read-only wherever it appears.
    const proFixtures = runnable.filter((f) => f.format === "pro");
    it.each(proFixtures)("$variant: objectType shown + read-only; subType read-only where present", (fx) => {
        const parseResult = proParser.parse(new Uint8Array(fs.readFileSync(fx.file)));
        const resolved = resolveLayout("pro", layoutFor("pro"), buildModel(parseResult));
        expect(resolved?.fields["pro.header.objectType"], "objectType not shown in this variant").toBeDefined();
        expect(resolved?.fields["pro.header.objectType"]?.editable, "objectType must be read-only").toBe(false);
        for (const key of ["pro.itemProperties.subType", "pro.sceneryProperties.subType"]) {
            const row = resolved?.fields[key];
            if (row) expect(row.editable, `${key} must be read-only`).toBe(false);
        }
    });
});

describe("UX label guardrails", () => {
    const panels = collectPanelLabels();

    // B. No word common to most of a panel's sibling labels that also names the panel itself (the category
    // word the title already states, e.g. "Resist" under "Resistances"). A word shared by siblings but NOT in
    // the title (e.g. "Type" across Body/Kill/Damage Type) is a legitimate distinction, not a repeat.
    const stem3 = (w: string): string => w.slice(0, 3);
    it("no panel repeats its title's category word across its field labels", () => {
        const violations: string[] = [];
        for (const p of panels) {
            if (GENERIC_OK.has(p.key) || p.labels.length < 3) continue;
            const titleStems = new Set(
                labelWords(p.title)
                    .map((x) => x.toLowerCase())
                    .filter((x) => x.length >= 3 && !STOPWORDS.has(x))
                    .map((w) => stem3(w)),
            );
            const counts = new Map<string, number>();
            for (const label of p.labels)
                for (const w of new Set(labelWords(label).map((x) => x.toLowerCase())))
                    if (w.length >= 4 && !STOPWORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
            const threshold = Math.ceil(p.labels.length * 0.7);
            for (const [w, c] of counts)
                if (c >= threshold && titleStems.has(stem3(w)))
                    violations.push(`${p.key}: "${w}" in ${c}/${p.labels.length}`);
        }
        expect(violations, `panels repeating the title's category word:\n${violations.join("\n")}`).toEqual([]);
    });

    // C. No denylisted truncation, and no title-cased acronym that should be upper-case.
    it("no label uses a denylisted abbreviation or miscased acronym", () => {
        const violations: string[] = [];
        for (const p of panels)
            for (const label of p.labels)
                for (const w of labelWords(label)) {
                    if (ABBREVIATIONS.has(w.toLowerCase())) violations.push(`${p.key}: "${label}" (abbr "${w}")`);
                    if (MISCASED_ACRONYMS.has(w)) violations.push(`${p.key}: "${label}" (case "${w}")`);
                }
        expect(violations, `abbreviations / miscased acronyms:\n${violations.join("\n")}`).toEqual([]);
    });

    // D. No bare numbered slot labels (Slot 1, Object 3, Sound 12, Field 74) unless the panel opts out.
    it("no bare numbered slot labels", () => {
        const numbered = /^(Slot|Object|Sound|Field) \d+$/;
        const violations: string[] = [];
        for (const p of panels) {
            if (GENERIC_OK.has(p.key)) continue;
            for (const label of p.labels) if (numbered.test(label)) violations.push(`${p.key}: "${label}"`);
        }
        expect(violations, `bare numbered labels:\n${violations.join("\n")}`).toEqual([]);
    });
});
