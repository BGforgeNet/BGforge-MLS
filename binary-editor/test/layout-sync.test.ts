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
    for (const row of variant.rows)
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
