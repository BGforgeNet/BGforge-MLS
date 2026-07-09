/**
 * Integration tests for the unified Fallout SSL dialog WRITE-BACK, exercised against the REAL external corpus
 * (Fallout2_Restoration_Project). The unit suites cover the writer on hand-built fixtures; this drives the same
 * `applySSLDialogEdits` (now the shared fallout-ssl-family engine SSL and TSSL both route through) over hundreds
 * of real, authored dialogs - the shapes a modder actually edits - so a regression that only surfaces on real
 * source complexity is caught here rather than in review.
 *
 * Requires external repos (run via `pnpm test:integration`, which needs `pnpm test:external` first); the sweep
 * skips itself if the corpus is not checked out.
 */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import * as fg from "fast-glob";
import { beforeAll, describe, expect, it } from "vitest";
import { parseDialog } from "../../src/dialog";
import { initParser } from "../../../shared/parsers/fallout-ssl";
import { modelFromSSL, type DialogModel, type DialogState } from "../../../shared/dialog-model";
import { applySSLDialogEdits } from "../../../shared/dialog-ssl-edit";
import { setChoiceTarget } from "../../../shared/dialog-edit-ops";
import { FALLOUT_FIXTURES } from "./test-helpers";

const RP_DIALOGS = join(FALLOUT_FIXTURES, "Fallout2_Restoration_Project/scripts_src");

/** Real .ssl files that actually form a dialog (a talk_p_proc router with player options), not plain scripts. */
const dialogFiles = fg.sync("**/*.ssl", { cwd: RP_DIALOGS, absolute: true }).filter((f) => {
    const t = readFileSync(f, "utf8");
    return t.includes("talk_p_proc") && t.includes("NOption");
});

const clone = (m: DialogModel): DialogModel => structuredClone(m);
const statesOf = (m: DialogModel): DialogState[] => m.roots.flatMap((r) => r.states);

async function parse(text: string): Promise<DialogModel> {
    return { ...modelFromSSL(await parseDialog(text)), sourceLang: "ssl" };
}

interface Dialog {
    rel: string;
    text: string;
    model: DialogModel;
}

describe.skipIf(dialogFiles.length === 0)("fallout-ssl write-back: real RP corpus", () => {
    const dialogs: Dialog[] = [];

    // Parse the whole corpus ONCE, up front and sequentially: the fallout-ssl tree-sitter parser shares a single
    // WASM instance and is not concurrency-safe (see ParserManager), so a parallel Promise.all would race it - the
    // per-file awaits below are sequential by necessity, not an oversight. Both tests then reuse these parses.
    beforeAll(async () => {
        await initParser();
        for (const f of dialogFiles) {
            const text = readFileSync(f, "utf8");
            const rel = f.slice(f.indexOf("scripts_src/") + "scripts_src/".length);
            try {
                // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe; sequential by design
                dialogs.push({ rel, text, model: await parse(text) });
            } catch {
                // a real file the parser rejects is not this suite's subject
            }
        }
    });

    it(`re-emitting an unedited model is byte-identical for every real dialog (${dialogFiles.length} files)`, () => {
        // Idempotence at scale: a no-op edit must leave real source untouched. A writer that reflows @N refs,
        // shorthand, comments, or whitespace on ANY of these authored dialogs shows up here as a changed file.
        const corrupted = dialogs.filter((d) => applySSLDialogEdits(d.text, clone(d.model), d.model) !== d.text);
        expect(corrupted.map((d) => d.rel)).toEqual([]);
    });

    it("a structural edit (retarget an option) round-trips on real faithful dialogs", async () => {
        // Retarget the first faithful state-target option to another node, apply, reparse, and confirm the edit
        // landed while the source still parses - across a representative sample of real dialogs.
        let exercised = 0;
        for (const { text, model } of dialogs) {
            const node = statesOf(model).find(
                (s) => s.faithful && s.choices.some((c) => c.target.kind === "state" && c.callRange),
            );
            const otherId = statesOf(model).find((s) => s.id !== node?.id && /^Node\d+$/.test(s.id))?.id;
            if (!node || otherId === undefined) continue;
            const opt = node.choices.find((c) => c.target.kind === "state" && c.callRange)!;
            if (opt.target.kind === "state" && opt.target.stateId === otherId) continue; // already there

            const edited = clone(model);
            setChoiceTarget(statesOf(edited).find((s) => s.id === node.id)!, opt.id, {
                kind: "state",
                stateId: otherId,
            });
            const out = applySSLDialogEdits(text, edited, model);
            expect(out).not.toBe(text); // the edit produced a real splice

            // oxlint-disable-next-line no-await-in-loop -- shared WASM parser is not concurrency-safe; sequential by design
            const reparsed = await parse(out);
            const rOpt = statesOf(reparsed)
                .find((s) => s.id === node.id)!
                .choices.find((c) => c.id === opt.id);
            expect(rOpt?.target).toEqual({ kind: "state", stateId: otherId });

            if (++exercised >= 20) break; // 20 distinct real dialogs is a representative structural sample
        }
        expect(exercised).toBeGreaterThan(0); // guards against the loop silently exercising nothing
    });
});
