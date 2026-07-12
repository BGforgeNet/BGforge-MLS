/**
 * Reachability classifier over the REAL external Fallout SSL dialog corpus (Fallout2_Restoration_Project).
 *
 * A shipped, valid dialog is overwhelmingly reachable from its `talk_p_proc` entry - a mass "orphan" verdict
 * is a classifier false-positive, not real dead code. This is the oracle a single hand-picked file cannot
 * give: a population check's honest measure is a RATE across the corpus, not one confirming instance. The
 * bug this guards (the classifier ignoring `entryCalls`/`entryIds` and seeding only from `states[0]`)
 * produced orphan rates well over 50%; the fix brings it near zero.
 *
 * Requires external repos (`pnpm test:integration`, which needs `pnpm test:external` first); skips if absent.
 */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import * as fg from "fast-glob";
import { beforeAll, describe, expect, it } from "vitest";
import { parseDialog } from "../../src/dialog";
import { initParser } from "../../../shared/parsers/fallout-ssl";
import { modelFromSSL } from "../../../shared/dialog-model";
import { classifyReachability } from "../../../shared/dialog-reachability";
import { FALLOUT_FIXTURES } from "./test-helpers";

const RP_DIALOGS = join(FALLOUT_FIXTURES, "Fallout2_Restoration_Project/scripts_src");

// Only real .ssl files that actually form a dialog (a talk_p_proc router with player options), not plain scripts.
const files = fg
    .sync("**/*.ssl", { cwd: RP_DIALOGS, absolute: true })
    .filter((f) => {
        const t = readFileSync(f, "utf8");
        return t.includes("talk_p_proc") && t.includes("NOption");
    })
    .sort();

describe.skipIf(files.length === 0)("dialog reachability over the real Fallout SSL corpus", () => {
    beforeAll(async () => {
        await initParser();
    });

    it("classifies almost no nodes as orphan across authored dialogs (near-zero false-positive rate)", async () => {
        // parseDialog is CPU-bound sync work after the beforeAll init (tree-sitter parse), so mapping over the
        // corpus resolves each file's data before the next await runs - no parser-state interleaving. Aggregating
        // a corpus-wide rate needs every file's count together, which a per-file `it` cannot do.
        const perFile = await Promise.all(
            files.map(async (f) => {
                const model = modelFromSSL(await parseDialog(readFileSync(f, "utf8")));
                const total = model.roots.reduce((n, r) => n + r.states.length, 0);
                if (total === 0) return null;
                let o = 0;
                for (const v of classifyReachability(model).values()) if (v === "orphan") o++;
                const rel = f.slice(f.indexOf("scripts_src/") + "scripts_src/".length);
                return { file: rel, rate: o / total, orphan: o, total };
            }),
        );

        let nodes = 0;
        let orphans = 0;
        const worst: Array<{ file: string; rate: number; orphan: number; total: number }> = [];
        for (const r of perFile) {
            if (r === null) continue;
            nodes += r.total;
            orphans += r.orphan;
            if (r.orphan > 0) worst.push(r);
        }
        worst.sort((a, b) => b.rate - a.rate);
        const rate = nodes > 0 ? orphans / nodes : 0;

        // A genuine disconnected island can exist in authored content, so allow a small margin. The bug this
        // guards produced >50% orphans; the observed post-fix rate is 0.05% (7 orphans / 13244 nodes across 440
        // dialogs), all in a handful of files (hcencha 3, scrobo 2, ncmason 2) that look like real dead nodes.
        // 2% keeps ~40x headroom over genuine islands while any reintroduction of the seeding bug spikes past it.
        expect(
            rate,
            `orphan rate ${(rate * 100).toFixed(2)}% across ${nodes} nodes in ${files.length} dialogs; ` +
                `worst: ${JSON.stringify(worst.slice(0, 8))}`,
        ).toBeLessThan(0.02);
    });
});
