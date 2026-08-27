/**
 * Guard-noise gate for the numeric-range advisory (window.ts projectRow): the effective range
 * (storage-type bounds narrowed by any domain declaration) must stay SILENT on every real, already-valid
 * fixture the suite parses - a field-local check that flags correct data trains users to ignore it (see
 * coding.md "A guard that false-positives is worse than no guard"). This walks every committed PRO/MAP/ITM
 * fixture (client/testFixture/**, grammars/weidu-tp2/test/samples) plus the same gitignored external/ mod
 * fixtures other suites in this package already parse for SPL/EFF/CRE (external/ is reproducible via
 * `pnpm test:external` - see CONTRIBUTING.md "Testing against real external files"; each external entry is
 * existence-gated so the run skips cleanly when not checked out) and asserts every projected field's
 * rawValue falls within its own row.min/row.max.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore } from "../src/session";
import { setExpanded } from "../src/model";
import { getWindow } from "../src/window";

const REPO = path.resolve(__dirname, "../..");
const repo = (rel: string): string => path.join(REPO, rel);

interface Fixture {
    file: string;
    uri: string;
    /** MAP needs graceful boundary recovery to open some real fixtures (sfsheng.map fails strict parsing
     *  by design - see map-parser.test.ts's LOCAL_GRACEFUL_FIXTURE_MAPS). */
    graceful?: boolean;
}

function filesWithExt(dir: string, ext: string): string[] {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return filesWithExt(p, ext);
        return e.name.endsWith(ext) ? [p] : [];
    });
}

function committed(dir: string, ext: string, graceful?: boolean): Fixture[] {
    return filesWithExt(dir, ext).map((file) => ({ file, uri: `file:///corpus${ext}`, graceful }));
}

/** A single named external fixture, included only when present (gitignored corpus, per-file gated like
 *  lock-guard.test.ts's SPL_FIXTURE/EFF_FIXTURE/CRE_FIXTURE constants). */
function external(rel: string, graceful?: boolean): Fixture[] {
    const file = repo(rel);
    if (!fs.existsSync(file)) return [];
    return [{ file, uri: `file:///corpus${path.extname(file)}`, graceful }];
}

// Committed corpora: every non-malformed PRO fixture (matches pro-roundtrip.test.ts's GOOD_DIRS), every
// committed MAP fixture, and the one committed ITM sample.
const PRO_DIRS = ["misc", "walls", "tiles", "critters", "scenery", "items"];
const CORPUS: Fixture[] = [
    ...PRO_DIRS.flatMap((d) => committed(repo(`client/testFixture/proto/${d}`), ".pro")),
    ...committed(repo("client/testFixture/maps"), ".map", true),
    ...committed(repo("grammars/weidu-tp2/test/samples"), ".itm"),
    // The same external fixtures SPL/EFF/CRE round-trip and detail-view suites elsewhere in this package
    // already parse (lock-guard.test.ts, cre-effect-detail.test.ts, summary.test.ts) - reused rather than
    // scanning the whole (very large) external/ mod trees.
    ...external("external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm"),
    ...external("external/infinity-engine/bg2-wildmage/wildmage/wild_spells/spl/wm_word.spl"),
    ...external("external/infinity-engine/Ascension/ascension/powers/resource/berserk.spl"),
    ...external("external/infinity-engine/Ascension/ascension/balthazar/resource/balth01b.eff"),
    ...external("external/infinity-engine/BGT-WeiDU/bgt/modify/cre/edwin6.cre"),
    ...external("external/infinity-engine/BGT-WeiDU/bgt/base/cre/bpimoen.cre"), // CRE v2 header
    ...external("external/infinity-engine/BGT-WeiDU/bgt/fixpack/iron15.cre"), // CRE v1 header
    ...external("external/fallout/Fallout2_Restoration_Project/data/maps/denbus1.map", true),
];

describe.skipIf(CORPUS.length === 0)("numeric range advisory stays silent on real fixtures", () => {
    it.each(CORPUS)("$file: every parsed field value is within its own effective range", ({ file, uri, graceful }) => {
        const bytes = new Uint8Array(fs.readFileSync(file));
        const { sessionId, errors } = openSession(uri, bytes, graceful ? { gracefulMapBoundaries: true } : {});
        expect(errors, `${file} failed to open: ${errors.join("; ")}`).toEqual([]);
        const session = sessionStore.get(sessionId);
        if (!session) throw new Error(`fixture did not open a session: ${file}`);
        for (const n of session.model.nodes) if (n.childCount > 0) setExpanded(session.model, n.id, true);
        const rows = getWindow(session.model, 0, 1_000_000, session.relationshipModel);
        for (const row of rows) {
            if (row.min === undefined || row.max === undefined) continue;
            const raw = typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue);
            expect(
                raw,
                `${file} field "${row.name}" (${raw}) below its effective range [${row.min}, ${row.max}]`,
            ).toBeGreaterThanOrEqual(row.min);
            expect(
                raw,
                `${file} field "${row.name}" (${raw}) above its effective range [${row.min}, ${row.max}]`,
            ).toBeLessThanOrEqual(row.max);
        }
    });
});
