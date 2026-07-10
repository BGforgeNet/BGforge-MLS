/**
 * Fallout SSL (tree-sitter) dialog write-back over the REAL external corpus (Fallout2_Restoration_Project).
 * Runs the shared write-back battery (`dialog-writeback-corpus.ts`) - idempotence plus every structural edit -
 * through `applySSLDialogEdits` (the shared fallout-ssl-family engine SSL and TSSL both route through) over
 * hundreds of authored dialogs, so a regression that only surfaces on real source complexity is caught here.
 *
 * Requires external repos (`pnpm test:integration`, which needs `pnpm test:external` first); skips if absent.
 */

import { join } from "node:path";
import { readFileSync } from "node:fs";
import * as fg from "fast-glob";
import { parseDialog } from "../../src/dialog";
import { initParser } from "../../../shared/parsers/fallout-ssl";
import { modelFromSSL, type DialogModel } from "../../../shared/dialog-model";
import { applySSLDialogEdits } from "../../../shared/dialog-ssl-edit";
import { defineWritebackCorpus } from "./dialog-writeback-corpus";
import { FALLOUT_FIXTURES } from "./test-helpers";

const RP_DIALOGS = join(FALLOUT_FIXTURES, "Fallout2_Restoration_Project/scripts_src");

const CAP = 150;
// Only real .ssl files that actually form a dialog (a talk_p_proc router with player options), not plain scripts.
const all = fg
    .sync("**/*.ssl", { cwd: RP_DIALOGS, absolute: true })
    .filter((f) => {
        const t = readFileSync(f, "utf8");
        return t.includes("talk_p_proc") && t.includes("NOption");
    })
    .sort();
const step = Math.max(1, Math.ceil(all.length / CAP));
const files = all.filter((_, i) => i % step === 0); // even spread, capped for runtime

defineWritebackCorpus({
    family: "fallout-ssl",
    files,
    relOf: (f) => f.slice(f.indexOf("scripts_src/") + "scripts_src/".length),
    init: () => initParser(),
    parse: async (text): Promise<DialogModel> => ({ ...modelFromSSL(await parseDialog(text)), sourceLang: "ssl" }),
    apply: applySSLDialogEdits,
});
