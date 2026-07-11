/**
 * TSSL (fallout-ssl family, ts-morph source) write-back over the real corpus: the committed `.tssl` dialog
 * samples (flat / bundle / conditional / nested / scoped shapes) plus every real `.tssl` in the external Fallout
 * trees. TSSL reached structural parity with SSL and routes its own `applyTSSLDialogEdits`. Battery in
 * `dialog-writeback-corpus.ts`.
 */

import { join, resolve } from "node:path";
import * as fg from "fast-glob";
import { modelFromSSL, type DialogModel } from "../../../shared/dialog-model";
import { parseTSSLSource } from "../../src/tssl/dialog-source";
import { applyTSSLDialogEdits } from "../../../shared/dialog-tssl-edit";
import { defineWritebackCorpus } from "./dialog-writeback-corpus";
import { FALLOUT_FIXTURES } from "./test-helpers";

const ROOT = resolve(__dirname, "../../..");
const samples = fg.sync("*.tssl", { cwd: join(ROOT, "server/test/tssl/samples"), absolute: true });
const external = fg.sync("**/*.tssl", { cwd: FALLOUT_FIXTURES, absolute: true });

defineWritebackCorpus({
    family: "weidu-tssl",
    files: [...samples, ...external],
    relOf: (f) => f.split("/").slice(-2).join("/"),
    parse: (text): Promise<DialogModel> =>
        Promise.resolve({ ...modelFromSSL(parseTSSLSource(text)), sourceLang: "tssl" }),
    apply: applyTSSLDialogEdits,
});
