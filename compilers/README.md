# Compilers

Two compilers that turn source into Fallout INT bytecode, and a codec for the Infinity Engine's compiled
script format.

| Package                | Source                            | CLI    | What it is                                                                                                |
| ---------------------- | --------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| [ssl](ssl/README.md)   | Fallout SSL (.ssl, .h)            | `ssl`  | The language Fallout scripts are already written in. Output is byte-identical to the reference `sslc`.    |
| [tssl](tssl/README.md) | TSSL, a TypeScript subset (.tssl) | `tssl` | Type checking, autocomplete and imports, compiled straight to bytecode. `--transpile` also writes `.ssl`. |
| [bcs](bcs/README.md)   | Infinity Engine BCS (.bcs, .bs)   | none   | Reads a compiled script into a tree and writes it back byte for byte. No compiler; the format is ASCII.   |

`ssl` owns the shared back end - the IR, the optimizer and the emitter - and `tssl` is a second front end
onto it, which is why the two live together. `bcs` shares nothing with either: BCS is not bytecode, so its
codec is a text format's reader and writer rather than a compiler.

More on how they fit into the extension: [docs/architecture.md](../docs/architecture.md).
