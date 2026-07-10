/**
 * TD (weidu-d family, ts-morph source) write-back over the real corpus: the committed realistic `.td` samples
 * (chain-form transitions, multi-line variadic appends WITH trailing commas - the shapes that broke the writer)
 * plus every real `.td` in the external Infinity Engine trees. See `dialog-writeback-corpus.ts` for the battery.
 */

import { join, resolve } from "node:path";
import * as fg from "fast-glob";
import { modelFromD, type DialogModel } from "../../../shared/dialog-model";
import { parseTDSource } from "../../src/td/dialog-source";
import { applyTDDialogEdits } from "../../../shared/dialog-td-edit";
import { defineWritebackCorpus } from "./dialog-writeback-corpus";
import { IE_FIXTURES } from "./test-helpers";

const ROOT = resolve(__dirname, "../../..");
const samples = fg.sync("*.td", { cwd: join(ROOT, "server/test/td/samples"), absolute: true });
const external = fg.sync("**/*.td", { cwd: IE_FIXTURES, absolute: true });

defineWritebackCorpus({
    family: "weidu-td",
    files: [...samples, ...external],
    relOf: (f) => f.split("/").slice(-2).join("/"),
    parse: (text): Promise<DialogModel> =>
        Promise.resolve({ ...modelFromD(parseTDSource(text)), sourceLang: "td", editable: true }),
    apply: applyTDDialogEdits,
});
