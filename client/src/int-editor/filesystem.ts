/**
 * The `.int` script view: a compiled Fallout script served as editable SSL.
 *
 * Only what makes this view differ from the `.bcs` one lives here - the rendering, the compile, and the one
 * refusal a disassembly listing needs. Everything else is `script-view/filesystem.ts`.
 */

import * as fs from "fs";
import { problemsOf } from "../../../compilers/ssl/src/problems";
import { ScriptViewFileSystemProvider, type ScriptView } from "../script-view/filesystem";
import { compileForSave } from "./compiler";
import { INT_SCHEME, LISTING_MARKER, VIEW_SUFFIX, render } from "./document";

export function intScriptView(extensionPath: string): ScriptView {
    return {
        scheme: INT_SCHEME,
        diagnostics: "bgforge-int",
        viewSuffix: VIEW_SUFFIX,
        render,
        problemsOf,
        // A listing describes the code, it is not the code - so compiling the comments back would write an
        // empty script over the file. Keyed off the TEXT rather than the file: the same `.int` renders as
        // source the moment it can be decompiled.
        refuseText: (file, text) =>
            text.includes(LISTING_MARKER)
                ? `${file} opened as a disassembly listing because it could not be decompiled, so there is ` +
                  `no source to compile back. Edit the original .ssl and compile it instead.`
                : undefined,
        compile: (file, text) => compileForSave(extensionPath, text, new Uint8Array(fs.readFileSync(file))),
    };
}

export class IntFileSystemProvider extends ScriptViewFileSystemProvider {
    constructor(extensionPath: string) {
        super(intScriptView(extensionPath));
    }
}
