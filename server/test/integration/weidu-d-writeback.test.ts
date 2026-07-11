/**
 * D (weidu-d, tree-sitter) write-back over the real Infinity Engine corpus - the largest editable-dialog corpus
 * the project ships against (hundreds of authored `.d` files: chain SAY blocks, IF ~trigger~ gates, multi-state
 * BEGIN blocks, extern targets). See `dialog-writeback-corpus.ts` for the battery.
 *
 * The full corpus is thousands of files; parsing each through the WASM parser sequentially is the runtime cost,
 * so this samples an even spread across the (sorted) corpus - diverse mods, bounded wall-clock - rather than all.
 */

import * as fg from "fast-glob";
import { initParser } from "../../../shared/parsers/weidu-d";
import { parseDDialog } from "../../src/weidu-d/dialog";
import { modelFromD, type DialogModel } from "../../../shared/dialog-model";
import { applyDDialogEdits } from "../../../shared/dialog-d-edit";
import { defineWritebackCorpus } from "./dialog-writeback-corpus";
import { IE_FIXTURES } from "./test-helpers";

const CAP = 200;
const all = fg.sync("**/*.d", { cwd: IE_FIXTURES, absolute: true }).sort();
const step = Math.max(1, Math.ceil(all.length / CAP));
const files = all.filter((_, i) => i % step === 0); // even spread across mods, capped for runtime

defineWritebackCorpus({
    family: "weidu-d",
    files,
    relOf: (f) => f.slice(f.indexOf("infinity-engine/") + "infinity-engine/".length),
    init: () => initParser(),
    parse: async (text): Promise<DialogModel> => ({
        ...modelFromD(parseDDialog(text)),
        sourceLang: "d",
        editable: true,
    }),
    apply: applyDDialogEdits,
});
