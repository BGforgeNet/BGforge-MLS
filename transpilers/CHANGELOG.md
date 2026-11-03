# Changelog

Notable changes to `@bgforge/transpile` (the library and the `fgtp` CLI).

## 0.6.0

### Changed

- `fgtp` type-checks each `.tbaf` and `.td` script before transpiling it, against the `tsconfig.json` that includes
  it, and does not transpile a script with type errors: it reports each error as
  `file:line:column: error TS<code>: message` and exits 1. A name the script does not bind, such as a misspelled
  engine action, is now an error instead of text in the generated file. `--no-typecheck` transpiles without the
  check. A script no `tsconfig.json` includes is checked with strict defaults. A project holding `.td` scripts gets
  the TD API declared, as in the editor.
- TBAF and TD compute every compile-time value the output uses from the syntax tree, as TypeScript evaluates it,
  and refuse what BAF or D cannot express rather than pass the source text through. A constant built from another
  constant, arithmetic, strings joined with `+` or a template literal, `arr[i]`, `obj.field` and ternaries now
  compile to their values. Refused, each with a message naming the construct: `var`, and `let` outside a loop
  counter; an assignment; a fraction; a result past 32 bits; a `/` that does not divide exactly (write
  `Math.trunc(a / b)` or `Math.floor(a / b)`); and any statement, or expression the output uses, that neither
  language has a meaning for.
- TBAF refuses an action outside any `if` or `switch`: its block matched on every pass, so no block after it ran.
- TBAF refuses a `switch` case that falls through into the next; empty cases stacked above one share its block.
- An `&&` inside an `||` compiles, distributed into the OR groups BAF and D hold, in both languages.

### Fixed

- TBAF decides a condition that is a compile-time constant, as documented: `const x = 1; if (x > 3)` emits no
  block, where it emitted one under `True()`. A condition that is neither a trigger call nor a compile-time
  boolean is an error, where it became `True()`.
- A constant declared in one function or block no longer takes the value of another declared elsewhere with the same
  name.
- Arithmetic is no longer folded inside a name: `(x1 * 2) / 2` no longer becomes `(x2) / 2`. A string's contents are
  written as they are: `"[1, 2] tra(5)"` no longer becomes `"[1.2] @5"`.
- TD resolves constants used as a chain speaker, an `extern` target and a chain action's argument, which reached the
  output as the constant's name, and a constant weight, which was refused or written as `#NaN`.
- TD's `else` and `else if` transitions carry the negation of the conditions before them, so only one branch's
  replies are offered.
- TD writes `tlkForced(n, text)` as `!n ~text~`, the form WeiDU reads; the text was dropped.

## 0.5.1

### Changed

- Ships an `internal` entry (`@bgforge/transpile/internal`) for the sibling packages of its repository. It carries
  no type declarations and is not part of the public API.

### Fixed

- `fgtp` reads a hyphenated no-value flag such as `--check-idempotency` correctly when a file follows it; before,
  the flag swallowed the file and the run failed with "No file or directory specified". A flag it does not know is
  refused by name.

## 0.5.0

### Changed

- Requires Node 22 or newer, up from 20.

### Fixed

- TBAF and TD leave string literals alone when substituting a loop variable or an inlined parameter: `"step i"`
  inside a loop over `i` is no longer rewritten to `"step 1"`, `"step 2"`.
- A number written in exponent form, such as `1e3`, reaches the BAF or D output in decimal in a file without
  imports too, as it already did in one with imports.
- TBAF inlines a function whose returned condition calls another user function, instead of failing with "a
  node that was removed or forgotten".
- `fgtp` refuses `--save-and-check` and `--check-idempotency` with an error instead of printing the output to
  stdout as though neither were given. `--help` no longer lists `--save-and-check`, which never saved or checked
  anything.

## 0.4.1

### Fixed

- Bundling a `.tbaf` or `.td` that imports other files writes round numbers such as 1000 in full, instead of
  the `1e3` form WeiDU rejects.
- A TD dialog declared with `export default` is emitted when its file imports other files, instead of the
  output coming out empty.
- TD fails with a positioned error when a trigger, an action or literal text contains `~`, instead of
  emitting a WeiDU string the tilde terminates early.
- TBAF and TD insert a substituted value literally: a value containing `$&` or `$1` is no longer read as a
  replacement pattern.
- A constant-expression parse error names the tokens it expected and found, instead of internal numbers.

## 0.4.0

### Fixed

- Constant arithmetic is folded before it reaches the emitted `.baf` or `.d`. A WeiDU argument is an
  operand, not an expression, so `SetGlobal("g", "GLOBAL", 1 + 333)` does not parse. Only integer results
  are folded - a division that does not divide evenly is left as written rather than emitted as a decimal.
- TD emits `INTERJECT_COPY_TRANS` with the bare `END` WeiDU expects, instead of an epilogue WeiDU rejects.

### Changed

- Bundling a `.tbaf` or `.td` that imports other files is roughly twice as fast, with output
  byte-identical across the external mod corpus.

## 0.3.0

### Fixed

- `fgtp --help` prints the help text once. It was registered with the argument parser and printed again
  by hand, so every invocation emitted two copies, the first with a stray colon appended.

### Removed

- **`.tssl` is no longer handled.** TSSL became a compiler in its own right and moved to
  [`@bgforge/tssl`](https://www.npmjs.com/package/@bgforge/tssl), which installs a `tssl` binary. Its
  default output is Fallout INT bytecode with no intermediate SSL; emitting the readable `.ssl` is an
  option (`tssl --transpile`) rather than the only thing it does, which is not a shape this CLI can
  express. `fgtp` now covers `.tbaf` and `.td`.

  Replace `fgtp src/ -r --save` with `tssl src/ -r --transpile` for TSSL sources, or drop `--transpile`
  to get bytecode directly.

  The library follows: `tssl`, `tsslWithSourceMap` and `createBatchState` are gone from
  `@bgforge/transpile`, `transpile()` no longer dispatches `.tssl`, and `outputPathFor()` no longer maps
  it.

## 0.2.1

Maintenance release.

## 0.2.0

### Added

- `fgtp --jobs <n>` processes directory files with `n` parallel workers. Output order matches the
  sequential walk; with `--check`, all files are checked before the exit code instead of stopping at
  the first mismatch.

## 0.1.2

### Fixed

- The TD transpiler now reports an error on a multi-variable `for` initializer during loop unrolling instead of silently keeping only the first variable.
- Multi-file transpiles no longer rely on a `node` binary on `PATH`; the bundler's child always runs on the current runtime.
- `quick-lru` is now a declared dependency, fixing standalone installs.

## 0.1.1

Maintenance release.

## 0.1.0

Initial release.
