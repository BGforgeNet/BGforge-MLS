# Compilers

Two compilers that turn source into Fallout INT bytecode, and a codec for the Infinity Engine's compiled
script format that reads it as BAF and writes BAF back.

| Package                | Source                            | CLI    | What it is                                                                                                        |
| ---------------------- | --------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| [ssl](ssl/README.md)   | Fallout SSL (.ssl, .h)            | `ssl`  | The language Fallout scripts are already written in. Output is byte-identical to the reference `sslc`.            |
| [tssl](tssl/README.md) | TSSL, a TypeScript subset (.tssl) | `tssl` | Type checking, autocomplete and imports, compiled straight to bytecode. `--ssl` also writes `.ssl`.               |
| [bcs](bcs/README.md)   | Infinity Engine BCS (.bcs, .bs)   | none   | Reads a compiled script into a tree and writes it back byte for byte, decompiles it to BAF and compiles BAF back. |

`ssl` owns the shared back end - the IR, the optimizer and the emitter - and `tssl` is a second front end
onto it, which is why the two live together. `bcs` shares nothing with either: BCS is not bytecode but a
text format, so its compiler emits records rather than instructions and needs no IR to do it.

## The two front ends onto one back end

`ssl` builds the IR from the SSL grammar. `tssl` builds it from a TypeScript AST
(`tssl/src/int/lower.ts`), so a `.tssl` reaches bytecode with no SSL text in between; it compiles the whole
FO2tweaks repo byte-identically to the text route - 27 scripts at `-O0`, `-O1`, `-O2` and the `-O2 -s` mods
ship - and still refuses, positioned at the line, anything it does not lower.

`tssl/src/desugar.ts` holds the expansions the two front ends must not reimplement separately: `for`,
`foreach`, `switch` and array/map literals all reach it from both sides.

`pnpm tssl-int-diff <repo-or-file> [switches] [-- more switches]` compiles each source both ways and
byte-compares, rendering both programs through `printProgram` and naming the first line they disagree on. It
runs in `scripts/test-transpile-external.sh` as an enforced gate, which is what makes an emitted `.ssl` a
guarantee rather than an offer: it is checked to compile to the same bytes the direct route produces. The
agreements that gate found, and which therefore cannot change casually, are listed in
[tssl/README.md](tssl/README.md).

**The text route is the oracle, and it is on a clock.** It works only while a mod still commits the
generated `.ssl`. Once that stops, the remaining check is `tssl-oracles`, which reports that a byte moved
without saying which construct moved it.

More on how they fit into the extension: [docs/architecture.md](../docs/architecture.md).
