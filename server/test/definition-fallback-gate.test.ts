/**
 * Guard: the definition handler's bare-word symbolDefinition fallback is ungated on string content
 * unless the provider also reports string positions. So any provider exposing getSymbolDefinition
 * MUST also expose isPositionInString - otherwise a filename inside a path string can collide with an
 * indexed symbol name and wrong-jump there (the tp2/fallout-ssl bug this gate exists to prevent).
 *
 * This pins the invariant so a future provider that adds getSymbolDefinition cannot silently
 * reintroduce the class - it fails here until it also implements string detection.
 */

import { describe, expect, it } from "vitest";
import type { LanguageProvider } from "../src/language-provider";
import { falloutSslProvider } from "../src/fallout-ssl/provider";
import { falloutWorldmapProvider } from "../src/fallout-worldmap/provider";
import { weiduBafProvider } from "../src/weidu-baf/provider";
import { weiduDProvider } from "../src/weidu-d/provider";
import { weiduTp2Provider } from "../src/weidu-tp2/provider";
import { infinity2daProvider } from "../src/infinity-2da/provider";
import { weiduLogProvider } from "../src/weidu-log/provider";

const PROVIDERS: Array<[string, LanguageProvider]> = [
    ["fallout-ssl", falloutSslProvider],
    ["fallout-worldmap", falloutWorldmapProvider],
    ["weidu-baf", weiduBafProvider],
    ["weidu-d", weiduDProvider],
    ["weidu-tp2", weiduTp2Provider],
    ["infinity-2da", infinity2daProvider],
    ["weidu-log", weiduLogProvider],
];

describe("definition fallback gate - capability pairing", () => {
    it.each(PROVIDERS)("%s: getSymbolDefinition implies isPositionInString", (_id, provider) => {
        if (typeof provider.getSymbolDefinition === "function") {
            expect(typeof provider.isPositionInString).toBe("function");
        }
    });

    it("at least one provider actually exercises the pairing (guard is not vacuous)", () => {
        const paired = PROVIDERS.filter(
            ([, p]) => typeof p.getSymbolDefinition === "function" && typeof p.isPositionInString === "function",
        );
        expect(paired.length).toBeGreaterThan(0);
    });
});
