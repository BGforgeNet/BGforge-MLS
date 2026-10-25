/**
 * Where the BAF provider finds TLK string references. The tree walk itself is covered in
 * `../strref-sites.test.ts`; these cases are about the provider's lookup of action names in the generated map.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../../src/logger", () => ({
    conlog: vi.fn(),
}));

import { weiduBafProvider } from "../../src/weidu-baf/provider";
import { initParser } from "@bgforge/shared/parsers/weidu-baf";
import { normalizeUri } from "../../src/core/normalized-uri";

const URI = normalizeUri("file:///t.baf");

beforeAll(async () => {
    await initParser();
});

const strrefsOf = (action: string): number[] =>
    weiduBafProvider.strRefs!(`IF\n  True()\nTHEN\n  RESPONSE #100\n    ${action}\nEND\n`, URI).map(
        (site) => site.strref,
    );

describe("weiduBafProvider.strRefs", () => {
    it("finds the strref of an action spelled as the data spells it", () => {
        expect(strrefsOf("DisplayString(Myself,123)")).toEqual([123]);
    });

    it("finds it whatever the letter case of the action name, as the reference resolves names", () => {
        expect(strrefsOf("displaystring(Myself,123)")).toEqual([123]);
        expect(strrefsOf("SETNAME(456)")).toEqual([456]);
    });

    it("finds a strref written with a hash", () => {
        expect(strrefsOf("DisplayString(Myself,#789)")).toEqual([789]);
    });
});
