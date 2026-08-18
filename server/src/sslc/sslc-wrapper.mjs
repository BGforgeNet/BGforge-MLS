/**
 * Runs the WebAssembly SSL compiler in the directory it was actually started in.
 *
 * The compiler package ships its own command-line wrapper, which derives the directory to compile in as
 * `join(parse(cwd).dir, parse(cwd).name)`. That reads whatever follows the last dot of the final segment as
 * a file extension and drops it, so a mod directory named for its version - `mymod.v2` - becomes `mymod`,
 * the compiler changes into a directory that does not exist, and the run dies with a bare
 * `ErrnoError undefined undefined` naming neither the cause nor the path. The working directory cannot
 * simply be moved somewhere without a dot: the compiler resolves `#include` against it.
 *
 * So this stands in for that wrapper, differing only in changing into the working directory as given. It
 * is forked rather than imported: a compile is a fresh process, which is what keeps a compiler crash away
 * from the language server. Output is collected and written once at the end rather than streamed, so what
 * the parent parses is shaped exactly as the package's own wrapper shaped it.
 *
 * Not a TypeScript file, unlike the rest of this directory: it is executed as-is rather than bundled, and
 * the module it loads is an Emscripten build that ships no types. The build copies it beside the server
 * bundle, where the same relative path from ssl_compiler.ts resolves as it does here in the source tree.
 */

// Named lowercase because it is a factory, not a constructor: the Emscripten build exports it
// capitalised, and calling it that way reads as a missing `new`.
import createCompiler from "sslc-emscripten-noderawfs";

const stdout = [];
const stderr = [];

let returnCode;
try {
    const instance = await createCompiler({
        print: (text) => stdout.push(text),
        printErr: (text) => stderr.push(text),
        noInitialRun: true,
    });

    // The whole point of this file. `process.cwd()` is where the parent asked for the compile to happen.
    instance.FS.chdir(process.cwd());
    returnCode = instance.callMain(process.argv.slice(2));
    instance.FS.chdir("/");
} catch (error) {
    returnCode = 1;
    stderr.push(`ERROR: ${error.name} ${error.message} ${error.stack}`);
}

console.log(stdout.join("\n"));
if (stderr.length > 0) console.error(stderr.join("\n"));
process.exit(returnCode);
