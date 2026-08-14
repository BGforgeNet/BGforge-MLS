# @bgforge/ssl

Fallout SSL compiler: preprocessor, parser, optimizer and INT back end, plus the `ssl` command-line
front end. It needs no native binary - it runs anywhere Node does, which is what lets the extension
compile on hosts the bundled compiler cannot run on.

Internal to this repository and not published. The extension's language server uses it as a library; the
CLI exists so the same compiler can be driven from a build script or checked by hand.

## Output

Compiled output is byte-identical to the reference `sslc` compiler at optimization levels 0, 1 and 2,
across every script in the Fallout modding corpora this repository tests against. The differential that
holds it there runs at each level in `test/integration/optimize-corpus.test.ts`, and
`test/integration/switch-differential.test.ts` runs both compilers under the same switches so the
sameness this table claims is observed rather than read off the reference's source.

## CLI

```bash
pnpm build:ssl                 # produces compilers/ssl/out/cli.js
pnpm ssl script.ssl            # or: node compilers/ssl/out/cli.js
```

The switches are the reference compiler's, so a build script written for it can call this instead:

```
Usage: ssl {switches} filename [-o outputname] [filename [..]]
  -q    accepted and ignored (this compiler never waits for input)
  -n    accepted and ignored (this compiler emits no warnings)
  -b    not supported: backward compatibility mode
  -l    no logo
  -p    accepted and ignored (this compiler always preprocesses)
  -P    preprocess only (don't generate .int)
  -F    accepted and ignored (this compiler emits no #line directives)
  -O<level>  optimize code
             0 - none
             1 - only remove unreferenced variables/procedures (default)
             2 - full (same as -O)
             3 - honoured as 2
  -d    show debug info
  -s    enable short-circuit evaluation for boolean operators (AND, OR)
  -D    dump the program as source after optimizations
  -m<macro>[=<val>]  define a macro named "macro" for conditional compilation
  -I<path>  specify an additional directory to search for include files
  -h, --help  show this help
```

Switches are read only up to the first file name, and everything after it is an input file optionally
followed by `-o <path>` - the reference's own grammar. `ssl -O2 a.ssl -o a.int b.ssl` compiles both;
`ssl a.ssl -O2` compiles `a.ssl` and then looks for a file called `-O2`.

### Where it differs from the reference

Everything below is a deliberate difference, not a gap:

| Switch or behaviour | Difference                                                                                                                                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-b`                | Refused. It removes later keywords - `switch`, `for`, `foreach`, `break`, `continue`, `pure`, `inline`, `tokenize` - from the language so old scripts may use them as names. This compiler's grammar has no mode that can express that.                              |
| `-O3`               | Honoured as `-O2`, with a warning. The passes above level 2 rename identifiers and share variable slots, both of which the reference's own source marks as known to break code.                                                                                      |
| `-p`                | Ignored: this compiler always preprocesses. The reference runs mcpp only when asked, so without `-p` its `-m` and `-I` reach nothing and a `#ifdef` is not evaluated at all - it compiles both arms. `#define` its lexer does handle.                                |
| `-F`                | Ignored: this compiler's preprocessor emits no `#line` directives, so there are no paths in them to lengthen. `-P` output therefore carries no line markers.                                                                                                         |
| `-q`, `-n`          | Ignored: this compiler never waits for input and emits no warnings, only errors. `-n` is what the reference calls "no warnings"; the extension's default options pass it, and above `-O1` the reference's own warnings mostly disappear with the code they describe. |
| Legacy statements   | `exit`, `detach`, `fork`, `spawn`, `callstart`, `exec`, `wait`, `noop`, `cancel`, `cancelall`, `startcritical` and `endcritical` are not parsed. They come from the language this one grew out of; no script in the Fallout corpora uses any of them.                |
| Preprocessor errors | The first one stops the compile. The reference's preprocessor reports every error in a file before giving up, while its compiler proper stops at the first, so the two agree except when the failure is in preprocessing.                                            |
| `-m`                | May be repeated, each defining a macro; the reference keeps only the last. A macro that takes parameters is refused rather than silently mis-defined.                                                                                                                |
| Missing input       | An error that exits non-zero. The reference warns and still exits 0, which lets a build succeed without having read its input.                                                                                                                                       |
| Output naming       | The extension is read off the file name, not the whole path, so a directory containing a dot no longer misnames the output. A source already called `.int` compiles to `<name>1.int` rather than losing a character.                                                 |
| Globs               | Not expanded: arguments are taken literally and glob expansion is left to the shell. The reference expands them itself, for Windows.                                                                                                                                 |
| `-h`, `--help`      | Prints the usage. The reference has no help switch and silently ignores `--help`.                                                                                                                                                                                    |

## Library

```ts
import { compileFile, preprocess, readInt } from "@bgforge/ssl";
```

`compileFile` and `compileText` take a `web-tree-sitter` parser the caller owns, because loading the
grammar is asynchronous and every caller already has one. `buildProgram` and `emitProgram` are the same
pipeline split at the point where the optimized program exists, for callers that want to inspect it.
`readInt`, `formatDisassembly` and `decompileToProgram` read compiled files back.
