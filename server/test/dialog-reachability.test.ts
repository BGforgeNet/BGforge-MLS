import { beforeAll, describe, expect, it } from "vitest";
import { initParser as initWeiduD } from "../../shared/parsers/weidu-d";
import { parseDDialog } from "../src/weidu-d/dialog";
import { modelFromD } from "../../shared/dialog-model";
import { classifyReachability } from "../../shared/dialog-reachability";

// 1C reachability lens: honest three-way split (reachable / external-entry / orphan).
// A no-inbound state is entered from OUTSIDE the file (EXTERN), so it is external-entry,
// never a false "dead" - the fix for the 86% false-orphan rate the closed-graph-only
// version produced on real banter dialogs.
describe("dialog reachability (1C)", () => {
    beforeAll(async () => {
        await initWeiduD();
    });

    it("classifies a no-inbound non-entry state as external-entry, not orphan", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN main
  SAY ~start~
  IF ~~ THEN REPLY ~bye~ EXIT
END
IF ~~ THEN BEGIN banter_entry
  SAY ~entered via EXTERN from elsewhere~
  IF ~~ THEN REPLY ~bye~ EXIT
END
END
`;
        const r = classifyReachability(modelFromD(parseDDialog(d)));
        expect(r.get("main")).toBe("reachable"); // the root's canonical entry
        expect(r.get("banter_entry")).toBe("external-entry"); // nothing in-file points at it
    });

    it("follows GOTO from the entry to mark inbound-reached states reachable", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN main
  SAY ~start~
  IF ~~ THEN REPLY ~go~ GOTO second
END
IF ~~ THEN BEGIN second
  SAY ~second~
  IF ~~ THEN REPLY ~bye~ EXIT
END
END
`;
        const r = classifyReachability(modelFromD(parseDDialog(d)));
        expect(r.get("main")).toBe("reachable");
        expect(r.get("second")).toBe("reachable");
    });

    it("flags a disconnected island (mutual inbound, no path from an entry) as orphan", () => {
        const d = `BEGIN ~test~
IF ~~ THEN BEGIN main
  SAY ~start~
  IF ~~ THEN REPLY ~bye~ EXIT
END
IF ~~ THEN BEGIN island_a
  SAY ~island a~
  IF ~~ THEN REPLY ~go~ GOTO island_b
END
IF ~~ THEN BEGIN island_b
  SAY ~island b~
  IF ~~ THEN REPLY ~back~ GOTO island_a
END
END
`;
        const r = classifyReachability(modelFromD(parseDDialog(d)));
        expect(r.get("main")).toBe("reachable");
        // Each island state's only inbound is the other - so neither is an external entry,
        // and neither is reachable from `main`: a genuine dead island.
        expect(r.get("island_a")).toBe("orphan");
        expect(r.get("island_b")).toBe("orphan");
    });
});
