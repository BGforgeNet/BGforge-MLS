/**
 * Measures TBAFTransformer.parseExpressionFromText, which is called many times
 * per transpile inside condition-algebra. The hot allocation is ts-morph
 * Project construction; the implementation reuses a module-scoped shared
 * Project (see transpilers/common/shared-project.ts).
 */
import { bench, describe } from "vitest";
import { TBAFTransformer } from "../../../transpilers/tbaf/src/transform";

// Observe results externally so V8 can't dead-code-eliminate the calls.
let sink = 0;

describe("TBAFTransformer.parseExpressionFromText", () => {
    const t = new TBAFTransformer();

    bench("parseExpressionFromText x 1", () => {
        const expr = t.parseExpressionFromText("Global('foo', 'LOCALS', 1)");
        sink += expr ? expr.getText().length : 0;
    });
});

export { sink };
