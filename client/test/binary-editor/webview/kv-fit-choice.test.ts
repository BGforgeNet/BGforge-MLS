import { describe, expect, it } from "vitest";
import { pickKvFit, type KvFitMeasure } from "../../../src/binary-editor/webview/state/kv-fit-choice";

/** A measurement per column count, and the counts measured, in order. */
function measurer(byColumns: Record<number, KvFitMeasure>): {
    measureAt: (columns: number) => KvFitMeasure;
    measured: number[];
} {
    const measured: number[] = [];
    return {
        measured,
        measureAt: (columns) => {
            measured.push(columns);
            return byColumns[columns]!;
        },
    };
}

const fits = { holds: true, besideSiblings: true };
const wrapsBelow = { holds: true, besideSiblings: false };
const squeezed = { holds: false, besideSiblings: true };

describe("pickKvFit", () => {
    it("keeps the widest count that holds beside its siblings and measures no narrower one", () => {
        const m = measurer({ 3: squeezed, 2: fits, 1: fits });
        expect(pickKvFit(3, m.measureAt)).toStrictEqual({ columns: 2, stacked: false });
        expect(m.measured).toStrictEqual([3, 2]);
    });

    it("sheds a column to stay beside the siblings rather than keep a wider count that wraps them", () => {
        const m = measurer({ 2: wrapsBelow, 1: fits });
        expect(pickKvFit(2, m.measureAt)).toStrictEqual({ columns: 1, stacked: false });
    });

    it("takes the widest count that holds once no count fits beside the siblings", () => {
        const m = measurer({ 3: squeezed, 2: wrapsBelow, 1: wrapsBelow });
        expect(pickKvFit(3, m.measureAt)).toStrictEqual({ columns: 2, stacked: false });
        expect(m.measured).toStrictEqual([3, 2, 1]);
    });

    it("stacks labels above controls when no count holds", () => {
        const m = measurer({ 2: squeezed, 1: squeezed });
        expect(pickKvFit(2, m.measureAt)).toStrictEqual({ columns: 1, stacked: true });
    });
});
