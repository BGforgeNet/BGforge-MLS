import { describe, expect, it, beforeAll } from "vitest";
import { parseDDialog } from "../src/weidu-d/dialog";
import { initParser, isInitialized } from "../../shared/parsers/weidu-d";

// A single-state dialog whose SAY is a multisay (`@a = @b = @c`). The model must keep every text,
// not just the first - the pre-existing truncation this test pins.
const SRC = `BEGIN ~TEST~
IF ~~ 0
  SAY @100 = @101 = @102
  IF ~~ EXIT
END`;

describe("D multisay is not truncated", () => {
    beforeAll(async () => {
        if (!isInitialized()) await initParser();
    });

    it("keeps every SAY text, in order", () => {
        const data = parseDDialog(SRC);
        // Find the state by its (currently truncated) first text so the finder is label-agnostic.
        const s = data.states.find((st) => st.sayText === "@100");
        expect(s).toBeDefined();
        expect(s!.sayTexts?.map((t) => t.text)).toEqual(["@100", "@101", "@102"]);
    });
});
