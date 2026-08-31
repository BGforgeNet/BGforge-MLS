/**
 * The strref parameter map is generated from the shipped engine data, so these run against that real YAML
 * rather than a fixture: a hand-written signature would only restate the assumption under test.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateStrRefParams, loadData, renderStrRefParamsModule } from "../src/generate-data.ts";
import { strRefParamIndexes } from "../../../shared/strref-params.ts";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const BAF_DATA = path.join(repoRoot, "server", "data", "weidu-baf-iesdp.yml");

/** The three YAMLs generate-data.sh feeds the BAF run, and the module it writes from them. */
const BAF_RUN_INPUTS = ["weidu-baf-base.yml", "weidu-baf-iesdp.yml", "weidu-baf-ids.yml"].map((name) =>
    path.join(repoRoot, "server", "data", name),
);
const GENERATED_MODULE = path.join(repoRoot, "server", "src", "weidu-baf", "strref-params.ts");

describe("strRefParamIndexes", () => {
    it("finds the StrRef parameter wherever the signature puts it", () => {
        expect(strRefParamIndexes("DisplayString(O:Object, StrRef:String)")).toEqual([1]);
        expect(strRefParamIndexes("SetName(StrRef:String)")).toEqual([0]);
        expect(strRefParamIndexes("SetPlayerSound(O:Object, StrRef:String, I:SlotNum*Sndslot)")).toEqual([1]);
    });

    it("returns nothing for a signature that declares no StrRef", () => {
        expect(strRefParamIndexes("SetGlobal(S:Name*, S:Area*, I:Value*)")).toEqual([]);
        expect(strRefParamIndexes("Continue()")).toEqual([]);
    });

    it("does not mistake a parameter merely named like one for a StrRef", () => {
        // The type prefix decides, not the parameter's name: `S:StrRef` is a token string, not a strref.
        expect(strRefParamIndexes("SetToken(S:StrRef, I:Value*)")).toEqual([]);
    });
});

describe("generateStrRefParams over the shipped BAF data", () => {
    const params = generateStrRefParams(loadData([BAF_DATA]));

    it("picks up the actions whose signatures declare a strref", () => {
        expect(params["DisplayString"]).toEqual([1]);
        expect(params["SetName"]).toEqual([0]);
        expect(params["AddJournalEntry"]).toEqual([0]);
        expect(params["SetPlayerSound"]).toEqual([1]);
    });

    it("omits every callable that takes none, rather than recording an empty list", () => {
        expect(params["SetGlobal"]).toBeUndefined();
        expect(params["Continue"]).toBeUndefined();
        expect(Object.values(params).every((indexes) => indexes.length > 0)).toBe(true);
    });

    it("covers exactly the signatures the data declares a StrRef in", () => {
        const declared = Object.values(loadData([BAF_DATA]))
            .flatMap((stanza) => stanza.items)
            .filter((item) => item.detail?.includes("StrRef:")).length;
        expect(Object.keys(params)).toHaveLength(declared);
        expect(declared).toBeGreaterThan(0);
    });
});

describe("renderStrRefParamsModule", () => {
    const rendered = renderStrRefParamsModule(generateStrRefParams(loadData(BAF_RUN_INPUTS)));

    it("matches the committed module byte for byte", () => {
        // The module is checked in and imported by the BAF provider, so an engine-data edit that skips
        // `pnpm generate-data` would otherwise ship a stale map with nothing to catch it.
        expect(fs.readFileSync(GENERATED_MODULE, "utf8")).toBe(rendered);
    });

    it("opens with the marker that keeps it out of the formatter", () => {
        // oxfmt-generated-exclusions.test.ts keys off this exact first line. Without it the file would be
        // reformatted and then differ from the generator's own output on the next run.
        expect(rendered.split("\n", 1)[0]).toMatch(/^\/\/ Auto-generated\b.*\bDo not hand-edit\.$/);
    });
});
