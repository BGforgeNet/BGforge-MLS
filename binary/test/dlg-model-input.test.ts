import { describe, expect, test } from "vitest";
import { readDlg } from "../src/dlg";
import type { DlgModelInput } from "../../shared/dialog-model-dlg";

/**
 * `shared/dialog-model-dlg.ts` declares its input structurally rather than importing `@bgforge/binary`, which
 * `shared/` does not depend on and should not start to. Nothing else checks the two shapes still agree, so a
 * field renamed on either side would break the dialog view with both packages typechecking cleanly. This is
 * where that assignability is pinned.
 */
describe("Dlg satisfies the dialog-model adapter's input", () => {
    test("a parsed DLG is assignable to DlgModelInput", () => {
        const bytes = new Uint8Array(0x34);
        const view = new DataView(bytes.buffer);
        for (const [i, c] of [..."DLG V1.0"].entries()) view.setUint8(i, c.codePointAt(0)!);
        view.setUint32(0x0c, 0x34, true);
        view.setUint32(0x14, 0x34, true);
        view.setUint32(0x18, 0x34, true);
        view.setUint32(0x20, 0x34, true);
        view.setUint32(0x28, 0x34, true);

        const dlg = readDlg(bytes);
        // The assignment IS the assertion: this stops compiling if either shape drifts.
        const input: DlgModelInput = { ...dlg, resref: "TEST" };

        expect(input.states).toEqual([]);
        expect(input.transitions).toEqual([]);
    });
});
