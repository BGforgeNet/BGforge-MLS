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

// A CHAIN whose entry line is a multisay. flattenChain's synthetic-state builder used the take-first
// extractChainText and never populated sayTexts, so the derived state silently dropped every text after the
// first - unlike parseState (BEGIN/APPEND/REPLACE), which records the full multisay list.
const CHAIN_SRC = `CHAIN BJKLSY chainmulti
@200 = @201 = @202
EXIT`;

describe("D CHAIN multisay is not truncated", () => {
    beforeAll(async () => {
        if (!isInitialized()) await initParser();
    });

    it("records every text of a chain line's multisay, in order", () => {
        const data = parseDDialog(CHAIN_SRC);
        const s = data.states.find((st) => st.sayText === "@200");
        expect(s).toBeDefined();
        expect(s!.sayTexts?.map((t) => t.text)).toEqual(["@200", "@201", "@202"]);
    });
});
