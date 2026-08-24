import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { readBcs, writeBcs } from "@bgforge/bcs";

/**
 * A small hand-authored corpus, standing in for the install sweep that cannot run in CI.
 *
 * The real sweep (`corpus.test.ts`) needs a game to point at, so nothing guards the shapes it found on a
 * push. These fixtures encode those shapes instead: they are written by hand from what a stock BG:EE plus
 * BG2:ToB pair actually contains, which also makes them an independent oracle - generating them with
 * `writeBcs` would only prove the codec agrees with itself.
 *
 * The second test is what keeps the set honest: deleting a fixture, or editing one until it no longer
 * carries the variant it was added for, has to fail rather than quietly shrink the corpus.
 */
const FIXTURE_DIR = path.join(__dirname, "fixtures");

function fixtures(): { name: string; text: string }[] {
    return fs
        .readdirSync(FIXTURE_DIR)
        .filter((f) => f.endsWith(".bcs"))
        .sort()
        .map((name) => ({ name, text: fs.readFileSync(path.join(FIXTURE_DIR, name), "latin1") }));
}

describe("BCS fixture corpus", () => {
    test("every fixture round-trips byte-identically", () => {
        const mismatched: string[] = [];
        let judged = 0;

        for (const { name, text } of fixtures()) {
            // The zero-byte fixture holds no script and is covered by its own test below.
            if (text === "") continue;
            judged++;
            if (writeBcs(readBcs(text)) !== text) mismatched.push(name);
        }

        expect(mismatched).toEqual([]);
        expect(judged).toBe(fixtures().length - 1);
    });

    test("the zero-byte fixture is refused rather than read as a blockless script", () => {
        const empty = fixtures().find((f) => f.text === "");

        expect(empty, "no zero-byte fixture in the corpus").toBeDefined();
        expect(() => readBcs(empty!.text)).toThrow(/Empty file/);
    });

    test("the corpus still covers every variant it was built for", () => {
        // Each entry is a shape the install sweep found and this corpus exists to guard. A fixture that
        // stops carrying its variant takes the guard with it, silently, unless something checks.
        const seen = {
            truncatedTrigger: false,
            truncatedAction: false,
            fullTrigger: false,
            fullAction: false,
            blocklessScript: false,
            responseWithNoActions: false,
            responseWithSeveralActions: false,
            conditionWithNoTriggers: false,
            objectNameEndingInADigit: false,
            wideObject: false,
            negativeField: false,
            signedExtremes: false,
            concatenatedAreaAndName: false,
        };

        for (const { text } of fixtures()) {
            if (text === "") continue;
            const script = readBcs(text);
            if (script.blocks.length === 0) seen.blocklessScript = true;
            for (const block of script.blocks) {
                if (block.triggers.length === 0) seen.conditionWithNoTriggers = true;
                for (const trigger of block.triggers) {
                    if (trigger.ints.length === 5 && trigger.strings.length === 2) seen.fullTrigger = true;
                    if (trigger.strings.length === 0) seen.truncatedTrigger = true;
                    if (trigger.object.ints.length > 12) seen.wideObject = true;
                    if (trigger.object.string.length > 0 && /\d$/.test(trigger.object.string)) {
                        seen.objectNameEndingInADigit = true;
                    }
                }
                for (const response of block.responses) {
                    if (response.actions.length === 0) seen.responseWithNoActions = true;
                    if (response.actions.length > 1) seen.responseWithSeveralActions = true;
                    for (const action of response.actions) {
                        if (action.ints.length === 5 && action.strings.length === 2) seen.fullAction = true;
                        if (action.strings.length === 0) seen.truncatedAction = true;
                        if (action.ints.some((n) => n < 0)) seen.negativeField = true;
                        if (action.ints.includes(2147483647) && action.ints.includes(-2147483648)) {
                            seen.signedExtremes = true;
                        }
                        // The documented rule: an action taking more than two strings packs an `Area` of
                        // exactly six characters in front of a `Name`, in one stored string.
                        if (action.strings.some((s) => s.startsWith("GLOBAL") && s.length > 6)) {
                            seen.concatenatedAreaAndName = true;
                        }
                    }
                }
            }
        }

        expect(
            Object.entries(seen)
                .filter(([, covered]) => !covered)
                .map(([shape]) => shape),
        ).toEqual([]);
    });
});
