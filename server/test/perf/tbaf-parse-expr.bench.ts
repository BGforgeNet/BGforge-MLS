/**
 * Measures TBAFTransformer.parseExpressionFromText, which is called many times
 * per transpile inside condition-algebra. Currently constructs a fresh ts-morph
 * Project per call; Task 4 routes it through a shared Project.
 */
import { bench, describe } from "vitest";
import { TBAFTransformer } from "../../../transpilers/tbaf/src/transform";

// Observe results externally so V8 can't dead-code-eliminate the calls.
let sink = 0;

describe("TBAFTransformer.parseExpressionFromText", () => {
    const t = new TBAFTransformer();

    bench("parseExpressionFromText x 1 (current: fresh Project per call)", () => {
        const expr = t.parseExpressionFromText("Global('foo', 'LOCALS', 1)");
        sink += expr ? expr.getText().length : 0;
    });
});

export { sink };
