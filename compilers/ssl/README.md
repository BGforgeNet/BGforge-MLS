# @bgforge/ssl

Fallout SSL compiler: preprocessor, parser, optimizer and INT back end, plus the `ssl` command-line
front end, as well as INT decompiler. It is a library rather than a program: no binary to install, and
no process to start, which is what lets the extension compile in places neither of the other two can be
run.

Internal to this repository and not published. The extension's language server uses it as a library; the
CLI exists so the same compiler can be driven from a build script or checked by hand.

## Output

Compiled output is byte-identical to the reference `sslc` compiler at optimization levels 0, 1 and 2,
across every script in the Fallout modding corpora this repository tests against. The `.int` a script
compiles to here is the one it would have compiled to there, so an existing build can adopt this compiler
without reissuing anything it has already shipped.

## CLI

```bash
pnpm build:ssl                 # produces compilers/ssl/out/cli.js
pnpm ssl script.ssl            # or: node compilers/ssl/out/cli.js
```

The switches are the reference compiler's, so a build script written for it can call this instead:

```
Usage: ssl {switches} filename [-o outputname] [filename [..]]
  -q    accepted and ignored (this compiler never waits for input)
  -n    no warnings
  -b    not supported: backward compatibility mode
  -l    no logo
  -p    accepted and ignored (this compiler always preprocesses)
  -P    preprocess only (don't generate .int)
  -F    accepted and ignored (this compiler emits no #line directives)
  -w    accepted and ignored (no effect in the reference either)
  -O<level>  optimize code
             0 - none
             1 - only remove unreferenced variables/procedures (default)
             2 - full (same as -O)
             3 - honoured as 2
  -d    show debug info
  -s    enable short-circuit evaluation for boolean operators (AND, OR)
  -D    dump the program as source after optimizations
  -j<n> compile n inputs at once (default: one per core; -j1 to disable)
  -m<macro>[=<val>]  define a macro named "macro" for conditional compilation
  -I<path>  specify an additional directory to search for include files
  -x, --decompile  read a compiled script and write its source (.int -> .ssl)
  -X, --listing    read a compiled script and write its instruction listing (.int -> .lst)
  -h, --help  show this help
```

Switches are read only up to the first file name, and everything after it is an input file optionally
followed by `-o <path>` - the reference's own grammar. `ssl -O2 a.ssl -o a.int b.ssl` compiles both;
`ssl a.ssl -O2` compiles `a.ssl` and then looks for a file called `-O2`.

Several inputs are compiled in parallel, one worker per core. Each is its own translation unit, reading
only its own source and the headers it includes, so nothing is shared between them and the outputs do not
depend on the schedule; output is buffered per input and printed in input order, so a parallel run reads
exactly like a sequential one. Over the 1500-script Restoration Project corpus at `-O2` that is 39.2s in
one thread against 9.2s across eight. Pass `-j1` where a build system already parallelises, or `-j<n>` to
cap it.

### Where it differs from the reference

Everything below is a deliberate difference, not a gap:

| Switch or behaviour       | Difference                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-b`                      | Refused. It removes later keywords - `switch`, `for`, `foreach`, `break`, `continue`, `pure`, `inline`, `tokenize` - from the language so old scripts may use them as names. This compiler's grammar has no mode that can express that.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `-O3`                     | Honoured as `-O2`, with a warning. The passes above level 2 rename identifiers and share variable slots, both of which the reference's own source marks as known to break code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `-p`                      | Ignored: this compiler always preprocesses. The reference runs mcpp only when asked, so without `-p` its `-m` and `-I` reach nothing and no directive is acted on at all - a `#ifdef` compiles both arms and a `#define` is discarded rather than expanded. Its lexer reads only `#line` and `#pragma sce`; every other directive line it skips.                                                                                                                                                                                                                                                                                                                                            |
| `-F`                      | Ignored: this compiler's preprocessor emits no `#line` directives, so there are no paths in them to lengthen. `-P` output therefore carries no line markers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `-q`                      | Ignored: this compiler never waits for input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Warnings                  | Three of the reference's, chosen for being about the script rather than about the compiler: an unknown escape in a string, a declaration repeated where the first one wins, and a missing `start`. Its other four are not reproduced - `Procedure X not referenced` fires on timed and conditional procedures, which the engine calls without any reference existing, and the remaining three report what its optimiser could not do. `-n` suppresses them, as it does there.                                                                                                                                                                                                               |
| Error reporting           | Every error a phase finds is reported, so one attempt names all of them; the phases run in order and the first one with any stops the compile, since later phases would only report damage the earlier errors caused. The reference does this in its preprocessor alone - its compiler proper stops at the first error.                                                                                                                                                                                                                                                                                                                                                                     |
| Error positions           | Every error carries the line and column it happened at. The reference's code-generation errors carry none - a procedure declared and never defined is reported as `<none>:-1`, naming the procedure but nothing to navigate to. An editor turns the position into the diagnostic's location, so a missing one puts the squiggle on line 1.                                                                                                                                                                                                                                                                                                                                                  |
| Copy then modify at `-O2` | `a = c; a += b;` keeps the value it was given: the copy folds into `a := c + b`. The reference drops the copy at `-O2` and reads the destination rather than the source, emitting `a := a + b` - so the sum is taken from the slot the copy was supposed to fill, which nothing has written. It emits the correct sequence at `-O0` and `-O1`, where the two agree byte for byte. Parity at `-O2` is therefore unreachable for a script that does this without reproducing the fault.                                                                                                                                                                                                       |
| Timed delay               | `procedure p in <expr>` requires an integer. The engine reads that table field raw and compares it as an unsigned deadline against the current game time, so a string's offset lands there as a small number that has already passed, and the procedure fires at once instead of after a delay. The reference emits one anyway.                                                                                                                                                                                                                                                                                                                                                             |
| Procedure as a variable   | Writing to a procedure's name - `p := 1`, `p++`, or a `for`/`foreach` loop variable naming one - is refused. The reference resolves the name to a number that is not a variable slot and stores into the local frame at that offset, which the frame does not reach: the engine indexes its value stack there, so the write either lands past the end or overwrites a live value belonging to something else. No corpus script does this.                                                                                                                                                                                                                                                   |
| `-m`                      | May be repeated, each defining a macro; the reference keeps only the last. A macro that takes parameters is refused rather than silently mis-defined.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Missing input             | An error that exits non-zero. The reference warns and still exits 0, which lets a build succeed without having read its input.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Output naming             | The extension is read off the file name, not the whole path, so a directory containing a dot no longer misnames the output. A source already called `.int` compiles to `<name>1.int` rather than losing a character.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Globs                     | Not expanded: arguments are taken literally and glob expansion is left to the shell. The reference expands them itself, for Windows.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `-x`, `-X`                | Read a compiled script instead of writing one: `-x` recovers it as source, `-X` as an instruction listing. The reference cannot read an `.int` at all. `-x` refuses a file it cannot structure back into source, where `-X` still describes one - which is what makes the listing worth its own switch rather than a fallback. Neither accepts the switches that shape a compile (`-O`, `-I`, `-m`, `-s`, `-P`, `-D`): those are refused rather than ignored, so nobody reads `-O2` as having optimised a decompile. Names not stored in a compiled script - locals, arguments, constants, macros and comments - cannot be recovered, and the recovered source says so in a header comment. |
| No-op switches            | `-q`, `-p`, `-F` and `-w` are accepted for compatibility and each says once that it did nothing. `-n` silences those notes along with warnings, for a build script that cannot drop the switch. The reference is silent about all four.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Several inputs            | Compiled in parallel, and one that fails does not stop the others: every input is attempted and the count of failures is reported at the end. The reference abandons the rest of the batch at its first error - given three files whose first is broken it writes no output at all, including for the two that compile.                                                                                                                                                                                                                                                                                                                                                                     |
| `-j<n>`                   | Not a reference switch. It sets how many inputs are compiled at once and changes nothing about the output; the reference compiles one at a time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `-h`, `--help`            | Prints the usage. The reference has no help switch and silently ignores `--help`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Matching the reference byte for byte is not itself a requirement - the standing rule is that every deliberate
difference is understood and recorded in the table above. Two conventions go with that: the reference's own
tables are not vendored (a handful of values in a test is fine), and its source files and internal symbols are
never cited - describe what it does instead.

## The two oracle manifests, and why they pin opposite things

Both sweeps compare against committed digests rather than a live process, and the difference between what
they pin is the whole point of having two.

| Manifest                                 | Sweep                           | Pins                                  | Regenerated by                      |
| ---------------------------------------- | ------------------------------- | ------------------------------------- | ----------------------------------- |
| `test/integration/reference-oracles.txt` | every corpus script, each level | the corpus AND the reference compiler | `pnpm ssl-oracles`                  |
| `test/integration/tssl-int-oracles.txt`  | each `.tssl` in a mod repo      | the corpus only                       | `pnpm tssl-oracles <repo> --update` |

`reference-oracles.txt` pins the compiler because bumping it invalidates the oracle: the digests describe
what that version emits. `pnpm ssl-oracles` re-runs the bundled compiler over the whole corpus and refuses to
write a manifest ours diverges from. The sweeps assert the corpus and compiler pins themselves and fail with
"regenerate" once either has moved.

`tssl-int-oracles.txt` is the inverse. There both the transpiler and the compiler are ours and under test, so
a digest that moves is a finding to review, never a prompt to regenerate - only the corpus is pinned, and
`--update` is an explicit reviewed act. It exists to outlive `ssl-equiv`, which needs a committed `.ssl` to
compare against and so cannot survive a mod dropping the intermediate. It is also the only sweep that
compiles a real script with `-s`; the switch sets are recorded in the manifest header and include the
`-O2 -s` mods actually ship.

## Library

```ts
import { compileFile, preprocess, readInt } from "@bgforge/ssl";
```

`compileFile` and `compileText` take a `web-tree-sitter` parser the caller owns, because loading the
grammar is asynchronous and every caller already has one. `buildProgram` and `emitProgram` are the same
pipeline split at the point where the optimized program exists, for callers that want to inspect it.
`readInt`, `formatDisassembly` and `decompileToProgram` read compiled files back, and `printProgram`
renders a recovered program as source. To compile that source back over the file it came from, pass the
original program's `stringLiterals` through `preserveStringOrder` into the rebuilt one before emitting:
a string's table position follows the order the source mentions it, so without that the bytes shift
even where the text did not change.
