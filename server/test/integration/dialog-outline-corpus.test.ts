/**
 * The dialog outline's ARIA sibling counters, over the REAL WeiDU .d corpus.
 *
 * `ariaPositions` derives `aria-posinset`/`aria-setsize` by walking the FLAT row list and tracking an ancestor
 * stack - it never sees the conversation tree those rows came from. This test derives the same numbers the
 * other way, recursing the tree itself, and requires the two to agree row for row. That is the property a
 * virtualized tree actually owes assistive tech: the DOM holds only a window, so the counters are the sole
 * source for "option 3 of 7", and nothing in the flat walk can notice that it has drifted from the structure.
 *
 * A differential, not a re-assertion of the implementation's own arithmetic: `pos` within `[1, size]` holds by
 * construction wherever `ariaPositions` assigns it, so a corpus is the wrong instrument for that. Row-key
 * uniqueness is likewise structural here - every key is namespaced by its owning state id, and this corpus
 * contains no state reached twice in one tree - so it is pinned at the unit tier, on fixtures where it can
 * fail, rather than restated over a population that cannot produce a collision.
 *
 * Lives here rather than under client/test because that is where the repo keeps real-corpus sweeps and the
 * external-fixture gate; server tests already import client dialog-editor modules directly.
 *
 * Requires external repos (`pnpm test:integration`, which needs `pnpm test:external` first); skips if absent.
 */

import { readFileSync } from "node:fs";
import * as fg from "fast-glob";
import { beforeAll, describe, expect, it } from "vitest";
import { buildConversationTree, type ConvState } from "../../../client/src/dialog-editor/webview/conversation-tree";
import { ariaPositions, flattenRows, rowAriaLevel } from "../../../client/src/dialog-editor/webview/tree-rows";
import { modelFromD } from "../../../shared/dialog-model";
import { initParser, isInitialized } from "../../../shared/parsers/weidu-d";
import { parseDDialog } from "../../src/weidu-d/dialog";
import { IE_FIXTURES } from "./test-helpers";

const files = fg.sync("**/*.d", { cwd: IE_FIXTURES, absolute: true }).sort();

/** One row's announced position, in the order the outline draws its treeitem rows. */
interface Seat {
    pos: number;
    size: number;
}

/**
 * The seats the tree structure implies, derived by recursion rather than by the flat walk.
 *
 * A state's treeitem children are its options interleaved with the states those options lead to - the outline
 * draws each option immediately followed by its destination's subtree, and announces the two at one level. So
 * one set holds both, and an option's position counts the destinations emitted before it.
 */
function seatsFromTree(roots: readonly ConvState[]): Seat[] {
    const seats: Seat[] = [];
    const walk = (state: ConvState, seat: Seat): void => {
        seats.push(seat);
        const destinations = state.replies.filter((reply) => reply.target.kind === "state").length;
        const size = state.replies.length + destinations;
        let pos = 0;
        for (const reply of state.replies) {
            seats.push({ pos: ++pos, size });
            if (reply.target.kind === "state") walk(reply.target.node, { pos: ++pos, size });
        }
    };
    for (const [index, root] of roots.entries()) walk(root, { pos: index + 1, size: roots.length });
    return seats;
}

describe.skipIf(files.length === 0)("the dialog outline's ARIA counters over the real .d corpus", () => {
    beforeAll(async () => {
        await initParser();
        // An uninitialised parser returns an empty dialog for every file, which reads as "every property
        // holds everywhere" instead of as a probe that never looked at anything.
        expect(isInitialized()).toBe(true);
    });

    it("announces every option and state at the position its tree structure implies", () => {
        const disagreements: string[] = [];
        let treesJudged = 0;
        let rowsCompared = 0;
        let unparsed = 0;
        let notFlat = 0;

        for (const path of files) {
            let model;
            try {
                model = modelFromD(parseDDialog(readFileSync(path, "utf8")));
            } catch {
                // A file the parser refuses is not this test's subject; the grammar suites own that.
                unparsed++;
                continue;
            }
            for (const root of model.roots) {
                if (root.states.length === 0) continue;
                const label = `${path.slice(IE_FIXTURES.length + 1)} [${root.label}]`;
                const tree = buildConversationTree(root, undefined, () => undefined);
                const editable = new Set(root.states.map((state) => state.id));
                const rows = flattenRows(tree.roots, new Set(), editable);
                // `seatsFromTree` models flat states only. Nothing in this corpus builds a bundle or block
                // node - those come from SSL - but a tree that did would be silently mis-modelled rather
                // than compared, so it is excluded by name and counted.
                if (rows.some((row) => row.kind === "branchLine")) {
                    notFlat++;
                    continue;
                }
                treesJudged++;

                const positions = ariaPositions(rows);
                const seated = rows
                    .filter((row) => rowAriaLevel(row) !== undefined)
                    .map((row) => positions.get(row.key));
                const expected = seatsFromTree(tree.roots);
                rowsCompared += seated.length;
                for (const [index, seat] of expected.entries()) {
                    const got = seated[index];
                    if (got?.pos !== seat.pos || got.size !== seat.size) {
                        const shown = got ? `${got.pos}/${got.size}` : "missing";
                        disagreements.push(
                            `${label}: row ${index} announced ${shown}, structure says ${seat.pos}/${seat.size}`,
                        );
                    }
                }
                if (seated.length !== expected.length) {
                    disagreements.push(
                        `${label}: ${seated.length} announced rows, structure implies ${expected.length}`,
                    );
                }
            }
        }

        // The exclusions, asserted rather than swallowed: a green run has to mean the sweep judged the
        // population it claims to, not that most of it fell out of the loop.
        expect(notFlat).toBe(0);
        expect(unparsed).toBeLessThan(files.length / 10);
        expect(treesJudged).toBeGreaterThan(1000);
        expect(rowsCompared).toBeGreaterThan(50_000);
        expect(disagreements.slice(0, 5)).toEqual([]);
    });
});
