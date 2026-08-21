# Compilers

See also: [transpilers/README.md](../transpilers/README.md) | [docs/architecture.md](../docs/architecture.md)

Two compilers that produce Fallout INT bytecode, from two different source languages. They are one program
in two halves: `ssl` owns the back end - the IR, the shared desugarings, the optimizer and the emitter - and
each compiler is a front end that lowers its own language into it.

| Package       | Source                 | Output          | CLI    | Distribution                 |
| ------------- | ---------------------- | --------------- | ------ | ---------------------------- |
| [ssl](ssl/)   | Fallout SSL (.ssl, .h) | `.int` bytecode | `ssl`  | internal to this repository  |
| [tssl](tssl/) | TSSL (.tssl)           | `.int` bytecode | `tssl` | publishes as `@bgforge/tssl` |

## [ssl](ssl/README.md) - Fallout SSL

Preprocessor, parser, optimizer and INT back end for the language Fallout scripts are already written in.
A library rather than a program, which is what lets the extension compile where the reference compiler
cannot run. Its output is byte-identical to the reference `sslc` at optimization levels 0, 1 and 2 across
the modding corpora this repository tests against.

Internal to this repository and not published; the language server uses it as a library, and the CLI exists
so the same compiler can be driven from a build script.

## [tssl](tssl/README.md) - TypeScript

A TypeScript subset compiled straight to bytecode: the TypeScript AST becomes the IR directly, with no SSL
text in between. Authors get type checking, autocomplete, go-to-definition and module imports while
targeting the same runtime as hand-written SSL.

Emitting the readable `.ssl` is one option of it (`--transpile`), kept because some mods still ship the
generated text and because an external compiler can be pointed at it.

## Keeping them honest

Because both front ends end at the same bytecode, they can be compared rather than trusted. `ssl` is checked
against the reference `sslc`, and `tssl` is checked against itself - the bytecode it emits directly against
the bytecode its own generated `.ssl` compiles to. The scripts in [ssl/scripts](ssl/scripts/) implement those
comparisons and run from the test gates; two are worth reaching for by hand:

```bash
pnpm ssl-diff <file.ssl>            # one construct, this compiler against the reference, in about a second
pnpm tssl-int-diff <dir-or-file>    # one TSSL source through both routes, byte-compared
```

Changing either compiler? [ssl/AGENTS.md](ssl/AGENTS.md) covers where a finding graduates to, and why the
corpus cannot tell you what the language is.
