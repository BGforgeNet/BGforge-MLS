import { describe, expect, test } from "vitest";
import { buildDlg, dlgParser, readDlg, toDlgBuildInput } from "../src/dlg";
import { DLG_VARIANTS } from "./dlg-variants";

/**
 * The install sweep's guarantees, held on a corpus that does not need an install.
 *
 * `dlg-corpus.test.ts` is where these properties were established, over 4286 real files, and it is gated on
 * a game directory the runner points it at - so on a push nothing checks them. These variants carry the
 * layouts that sweep found; see `dlg-variants.ts` for what each one is and how much of an install has it.
 */
describe("DLG variant corpus", () => {
    test.each(DLG_VARIANTS.map((v) => [v.name, v] as const))("%s parses without errors", (_name, variant) => {
        const result = dlgParser.parse(variant.bytes);

        expect(result.errors ?? []).toEqual([]);
        expect(result.document).toBeDefined();
    });

    test.each(DLG_VARIANTS.map((v) => [v.name, v] as const))("%s round-trips byte-identically", (_name, variant) => {
        // Preserve-mode: re-emitting a file over its own bytes has to reproduce it exactly, whatever layout
        // its producer chose.
        const round = dlgParser.serialize(dlgParser.parse(variant.bytes));

        expect([...round]).toEqual([...variant.bytes]);
    });

    test.each(DLG_VARIANTS.map((v) => [v.name, v] as const))(
        "%s survives a rebuild with its content intact",
        (_name, variant) => {
            // Rebuild-mode: `buildDlg` decides a layout rather than preserving one, so what it owes every
            // file is that nothing is lost or reordered on the way through.
            const before = readDlg(variant.bytes);

            const after = readDlg(buildDlg(toDlgBuildInput(variant.bytes)));

            expect(after).toEqual(before);
        },
    );

    test("a rebuild is byte-identical exactly for the files already in the canonical layout", () => {
        // The property the install sweep checks against 4286 files: where a rebuild differs, the difference
        // is the source file's layout choice, not a builder defect. Here each variant states which it is,
        // so a builder that started reproducing - or stopped reproducing - one would fail.
        const identical = DLG_VARIANTS.filter((variant) => {
            const round = buildDlg(toDlgBuildInput(variant.bytes));
            return round.byteLength === variant.bytes.byteLength && round.every((b, i) => b === variant.bytes[i]);
        }).map((variant) => variant.name);

        expect(identical).toEqual(DLG_VARIANTS.filter((v) => v.canonicalLayout).map((v) => v.name));
    });

    test("the corpus still covers every layout it was built for", () => {
        // A variant that stops being a variant - edited until it is just another standard file - takes its
        // guard with it, silently, unless something checks.
        const bg1Headers = DLG_VARIANTS.filter(
            (v) => !(dlgParser.parse(v.bytes).document as { headerInterrupt?: unknown }).headerInterrupt,
        );
        const nonCanonical = DLG_VARIANTS.filter((v) => !v.canonicalLayout);
        const empty = DLG_VARIANTS.filter((v) => readDlg(v.bytes).states.length === 0);

        expect(bg1Headers.length).toBeGreaterThanOrEqual(2);
        expect(nonCanonical.length).toBeGreaterThanOrEqual(3);
        expect(empty.length).toBeGreaterThanOrEqual(1);
        expect(new Set(DLG_VARIANTS.map((v) => v.name)).size).toBe(DLG_VARIANTS.length);
    });
});
