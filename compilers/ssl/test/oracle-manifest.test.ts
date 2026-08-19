/**
 * The oracle manifest: the committed record of what the bundled compiler produced for every corpus
 * script at every level. Parsing and freshness are pure string work, tested here; the sweep that
 * CONSUMES the manifest lives in test/integration, and the generator that runs the live differential
 * is scripts/ssl-oracles.mts.
 */

import { describe, expect, it } from "vitest";
import {
    compilerPinKey,
    corpusPinsOf,
    currentPins,
    formatManifest,
    parseManifest,
    staleness,
    type OracleManifest,
} from "./integration/oracle-manifest.ts";

const SAMPLE: OracleManifest = {
    compilerPin: "sha256:abc123",
    corpusPins: ["https://example.test/repo-a 1111111111111111111111111111111111111111"],
    entries: new Map([
        ["Fallout2_Restoration_Project/scripts_src/x/a.ssl", ["d".repeat(64), "e".repeat(64), "f".repeat(64)]],
        ["FO2tweaks/source/waypnt.ssl", ["refused", "refused", "refused"]],
    ]),
};

describe("manifest round-trip", () => {
    it("parses what it formats", () => {
        const parsed = parseManifest(formatManifest(SAMPLE));
        expect(parsed.compilerPin).toBe(SAMPLE.compilerPin);
        expect(parsed.corpusPins).toEqual(SAMPLE.corpusPins);
        expect(parsed.entries).toEqual(SAMPLE.entries);
    });

    it("keeps one entry per script with all three levels", () => {
        const text = formatManifest(SAMPLE);
        const entry = parseManifest(text).entries.get("FO2tweaks/source/waypnt.ssl");
        expect(entry).toEqual(["refused", "refused", "refused"]);
    });

    it("refuses a malformed data line rather than skipping it", () => {
        // A silently dropped line shrinks the comparison while every count stays plausible.
        expect(() => parseManifest("compiler sha256:x\nnot a valid line at all extra")).toThrow(/malformed/);
    });
});

describe("staleness", () => {
    it("is empty when the pins match", () => {
        expect(staleness(SAMPLE, SAMPLE.compilerPin, SAMPLE.corpusPins)).toEqual([]);
    });

    it("names a compiler pin that moved", () => {
        const stale = staleness(SAMPLE, "sha256:other", SAMPLE.corpusPins);
        expect(stale.join(" ")).toMatch(/compiler/);
    });

    it("names a corpus pin that moved", () => {
        const stale = staleness(SAMPLE, SAMPLE.compilerPin, [
            "https://example.test/repo-a 2222222222222222222222222222222222222222",
        ]);
        expect(stale.join(" ")).toMatch(/repo-a/);
    });
});

describe("current pins", () => {
    it("derives a stable key from the compiler dependency without naming it", () => {
        const key = compilerPinKey('{ "dependencies": { "x": "https://host/path/thing.tar.gz" } }', "x");
        expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
        // Same input, same key - and the key never contains the URL itself.
        expect(key).toBe(compilerPinKey('{ "dependencies": { "x": "https://host/path/thing.tar.gz" } }', "x"));
        expect(key).not.toContain("host");
    });

    it("finds the dependency where it actually sits: optionalDependencies", () => {
        const key = compilerPinKey('{ "optionalDependencies": { "x": "https://host/thing.tar.gz" } }', "x");
        expect(key).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("reads the pin the real server manifest carries", () => {
        // The producer-shape check the fixture above cannot give: the real file's section layout.
        expect(currentPins().compilerPin).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(currentPins().corpusPins).toHaveLength(4);
    });

    it("selects only the pinned corpus repos from the pin file, keeping their order", () => {
        const pinFile = [
            "# comment",
            "https://example.test/FO2tweaks aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "https://example.test/unrelated bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "https://example.test/sfall cccccccccccccccccccccccccccccccccccccccc",
        ].join("\n");
        const pins = corpusPinsOf(pinFile, ["FO2tweaks", "sfall"]);
        expect(pins).toEqual([
            "https://example.test/FO2tweaks aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "https://example.test/sfall cccccccccccccccccccccccccccccccccccccccc",
        ]);
    });

    it("refuses a corpus repo the pin file does not pin", () => {
        // An unpinned repo floats with upstream, so a manifest generated against it describes nothing
        // reproducible - better to refuse than to record a pin that does not exist.
        expect(() => corpusPinsOf("https://example.test/FO2tweaks", ["FO2tweaks"])).toThrow(/not pinned/);
    });
});
