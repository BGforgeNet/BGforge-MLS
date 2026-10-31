/**
 * The VSIX takes only the runtime files the root manifest's `files` allowlist names, whatever else sits in the
 * working tree.
 *
 * vsce does not read `.gitignore`, so under a denylist a gitignored build tree, a scratch note or an untracked
 * prototype beside the sources would ship. This runs vsce's own file collection, with the repo's packaging config,
 * over a tree that holds one file of each shipped kind beside such strays.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listFiles, PackageManager } from "@vscode/vsce";
import { afterAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

/** One file per kind the extension ships at runtime. */
const RUNTIME = [
    "package.json",
    "README.md",
    "LICENSE.txt",
    "SECURITY.md",
    "resources/bgforge.png",
    "language-configurations/fallout-ssl.language-configuration.json",
    "snippets/fallout-ssl.json",
    "syntaxes/fallout-ssl.tmLanguage.json",
    "themes/bgforge-icon-theme.json",
    "themes/bgforge-monokai.json",
    "themes/icons/fallout-ssl.svg",
    "themes/seti.woff",
    "client/package.json",
    "client/out/extension.js",
    "client/out/codicons/codicon.ttf",
    "client/src/gallery/webview/index.html",
    "client/src/webview-ui/base.css",
    "server/package.json",
    "server/LICENSE.txt",
    "server/out/server.js",
    "server/out/tree-sitter-ssl.wasm",
    "server/out/sslc-emscripten-noderawfs/sslc.mjs",
    "server/node_modules/esbuild-wasm/package.json",
    "server/node_modules/esbuild-wasm/esbuild.wasm",
    "server/node_modules/esbuild-wasm/bin/esbuild",
    "server/node_modules/esbuild-wasm/lib/main.js",
    "server/node_modules/esbuild-wasm/wasm_exec.js",
    "server/node_modules/esbuild-wasm/wasm_exec_node.js",
];

/** Development files and local strays a working tree carries. */
const STRAYS = [
    "notes.md",
    "target/debug/build.bin",
    "crates/prototype/Cargo.toml",
    "tmp/run.log",
    ".dev/tool/bin",
    "AGENTS.md",
    "docs/changelog.md",
    "scripts/package.sh",
    "syntaxes/fallout-ssl.tmLanguage.yml",
    "themes/vscode-monokai.json",
    "client/src/gallery/webview/main.ts",
    "client/src/gallery/webview/App.svelte",
    "client/src/dialog-editor/test/harness/app.html",
    "client/src/dialog-editor/test/harness/styles.css",
    "server/src/server.ts",
    "server/node_modules/esbuild-wasm/esm/browser.js",
    "server/node_modules/esbuild-wasm/README.md",
];

const tree = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-vsix-allowlist-"));

afterAll(() => fs.rmSync(tree, { recursive: true, force: true }));

describe("VSIX contents", () => {
    it("are the runtime files alone, with strays in the working tree", async () => {
        for (const file of [...RUNTIME, ...STRAYS]) {
            fs.mkdirSync(path.join(tree, path.dirname(file)), { recursive: true });
            fs.writeFileSync(path.join(tree, file), "");
        }
        fs.copyFileSync(path.join(REPO_ROOT, "package.json"), path.join(tree, "package.json"));
        const ignoreFile = path.join(REPO_ROOT, ".vscodeignore");
        if (fs.existsSync(ignoreFile)) fs.copyFileSync(ignoreFile, path.join(tree, ".vscodeignore"));

        const packaged = await listFiles({ cwd: tree, packageManager: PackageManager.None });

        expect(packaged.toSorted()).toEqual(RUNTIME.toSorted());
    });
});
