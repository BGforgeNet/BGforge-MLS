/**
 * Compiles a TSSL document straight to Fallout bytecode.
 *
 * TSSL is a compiler, not a transpiler: the TypeScript AST becomes the INT intermediate representation
 * directly, so no SSL text is produced or parsed on the way and there is no generated file for a
 * diagnostic to be relocated from - a refusal already carries the line in the source the author has open.
 *
 * The readable SSL remains available behind `bgforge.tssl.emitSsl`, for a mod that still ships it or an
 * author who wants to read what their script became. It is written from the same source, not decompiled
 * from the bytecode, and `scripts/test-transpile-external.sh` byte-compares the two routes across a real
 * corpus at every optimisation level, so the file beside the bytecode does compile to those bytes.
 */

import * as fs from "fs";
import { EXT_TSSL } from "../core/languages";
import { parseArgs } from "../../../compilers/ssl/src/args";
import { emitProgram } from "../../../compilers/ssl/src/compile";
import { optimize } from "../../../compilers/ssl/src/optimize";
import { lowerTsslProgram } from "../../../compilers/tssl/src/int/lower";
import { transpile } from "../../../compilers/tssl/src/index";
import { intOutputPath } from "../core/int-output-path";
import type { MLSsettings } from "../settings";

export interface TsslCompileResult {
    /**
     * Where the bytecode goes. A validation run with `compileOnValidate` off compiles the same bytes
     * and keeps none, so this names the throwaway it would have been rather than a file on disk - only
     * an interactive compile, which always writes, reads this.
     */
    intPath: string;
    /** Where the readable SSL landed, when the setting asks for it. */
    sslPath?: string;
}

/**
 * Compiles `text` and writes the result, returning what it produced. A refusal from the front end
 * propagates as the positioned `TranspileError` it already is.
 */
export async function compileTsslToInt(
    uri: string,
    filepath: string,
    text: string,
    settings: MLSsettings,
    interactive: boolean,
): Promise<TsslCompileResult> {
    // The optimisation switches come from the Fallout SSL compiler's own command line, because that
    // setting is what already decided how a `.tssl` was compiled when it went through generated SSL.
    // The rest of that line addresses an SSL text compiler - a preprocessor, a keyword set, an output
    // format - and names nothing a TypeScript source has, so it is not read here.
    const args = parseArgs(settings.falloutSSL.compileOptions.split(/\s+/).filter(Boolean));
    const options = { level: args.level, shortCircuit: args.shortCircuit };

    const program = lowerTsslProgram(filepath, text);
    const bytes = emitProgram(optimize(program, options), options);

    const written = interactive || settings.falloutSSL.compileOnValidate;
    const intPath = intOutputPath(filepath, settings.falloutSSL.outputDirectory, uri, written);
    if (written) {
        await fs.promises.writeFile(intPath, bytes);
    }

    if (!settings.tssl.emitSsl) return { intPath };

    // Written from the source rather than from `program`: the intermediate representation above has
    // already been desugared and optimised, so rendering it back would produce something that compiles
    // to the same bytes but no longer reads like the script the author wrote.
    const ssl = await transpile(filepath, text);
    const sslPath = filepath.slice(0, -EXT_TSSL.length) + ".ssl";
    await fs.promises.writeFile(sslPath, ssl, "utf-8");
    return { intPath, sslPath };
}
