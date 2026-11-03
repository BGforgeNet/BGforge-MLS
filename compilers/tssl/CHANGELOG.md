# Changelog

Notable changes to `@bgforge/tssl` (the compiler library and the `tssl` CLI).

## Unreleased

### Fixed

- A constant whose value is an operator expression keeps its grouping in the `.ssl` output. Its `#define` held the
  bare expression, so a use under a tighter operator regrouped: with `const b = a + 1`, `b * 2` computed
  `a + (1 * 2)`. The `.ssl` now parenthesises such a value, and a negative enum member, as `#define b (a + 1)`.
  Compiling to `.int` was not affected.
- An `@inline` function keeps its arguments' grouping. Its body took each argument as text, as the `#define` it
  mirrors does, so `twice(a + 1)` over `return x * 2` computed `a + (1 * 2)`. A parameter the body uses as an
  operand is now parenthesised, in the `.int` and in the `.ssl`, as `#define twice(x) ((x) * 2)`.

### Changed

- A top-level statement that is not a declaration (an assignment, a call, an `if`, a loop) is refused, naming its
  line. SSL has no module-level code, and both outputs used to drop such a statement without a word. `var` is
  refused the same way, with `let` or `const` as the remedy.
- Compiling to `.int` reads and writes a map property written with a dot, `m.id`, as the lookup `m["id"]`, which
  is what the `.ssl` output already compiled to. It used to refuse it.
- Reading or writing a key of a top-level `const` array or map (`CFG.id`, `IDS[0]`) is refused, naming the
  constant. Its `#define` made each use the literal itself, which SSL cannot index: the `.ssl` failed to compile,
  and the `.int` read a fresh copy, so a write was lost.

## 0.5.1

### Fixed

- A ternary `c ? a : b` compiles. The `.ssl` output wrote it as `?:`, which SSL does not have, so the compiler
  refused the file; it now writes SSL's conditional expression, `(a) if (c) else (b)`. Compiling to `.int` refused
  a ternary outright; it now compiles to the same bytecode the compiler produces from that SSL.
- `floor(x)` and `set_perk_skill1_mag(...)` compile to `.int`; before, both were refused as unknown procedures.

## 0.5.0

### Changed

- `tssl` type-checks each script before compiling it, against the `tsconfig.json` that includes it, and does
  not compile a script with type errors: it reports each error as `file:line:column: error TS<code>: ...` and
  exits 1. `--no-typecheck` compiles without the check. A script no `tsconfig.json` includes is checked with
  strict defaults.

### Added

- `a << n` with an integer literal `n` from 0 to 31 compiles, as a multiply by 2^n, since SSL has no shift. A
  computed count, `>>` and `>>>` are refused with what to write instead.

### Fixed

- A function named like an `@inline` function of an imported library, such as folib's `weapon_is_unusable`,
  compiles as itself; before, its body was dropped and calls expanded to the library's macro. When the script also
  calls the library's one, the compile is refused, naming both.

## 0.4.0

### Changed

- Depends on `@bgforge/transpile` for the shared pipeline, which npm installs with it; before, that code was bundled
  in. Ships an `internal` entry for the sibling packages of its repository, with no type declarations and outside
  the public API.

### Fixed

- A numeric literal written with `_` separators (`1_000`) compiles to its value. The bytecode used to hold 0 in
  its place, and `--ssl` wrote it unchanged, which SSL does not read.
- `--opt 2` folds a hex literal past `0x7FFFFFFF` as its 32-bit pattern: `0xFFFFFFFF == -1` folds to 1, as in
  the reference SSL compiler.
- A numeric literal in exponent form (`1e3`), binary (`0b101`) or octal (`0o17`) compiles to its value on the
  `--ssl` route too, written as the float (`1000.0`) or hex integer (`0x5`) SSL reads; before, `--ssl` kept the
  spelling, which SSL does not read.
- `tssl` reads a hyphenated no-value flag such as `--short-circuit` or `--save-and-check` correctly when a file
  follows it; before, the flag swallowed the file and the run failed with "No file or directory specified". A flag
  it does not know is refused by name.

## 0.3.0

### Changed

- Requires Node 22 or newer, up from 20.

### Deprecated

- `compile()`, which writes the `.ssl` itself: `transpile()` plus a write of the result does the same. It will
  be removed in the next major version.

### Fixed

- `tssl` refuses `--save-and-check` and `--check-idempotency` with an error. Both used to write the outputs
  like a plain run, so a check that should have left the tree alone rewrote it.
- Integer constants fold with 32-bit wraparound and float constants in 32-bit precision, as the reference
  compiler does, so a constant such as `2147483647 + 1` compiles to the same value in both.
- A string holding a character wider than one byte, such as a Chinese letter, is refused instead of compiled as
  a different character.
- Every procedure declared but never defined is reported, not only the first.

## 0.2.0

### Added

- `tssl --no-int` skips the bytecode, so `--ssl --no-int` writes the readable `.ssl` alone - for a tree
  that commits the SSL and has no use for the `.int`. Passing it without `--ssl` is an error, since the
  run would write nothing. `--opt` and `-s` steer the bytecode emitter it skips, so passing either
  alongside warns and carries on rather than failing the run.

### Changed

- **`--transpile` is now `--ssl`.** The old spelling is gone rather than aliased. The two output switches
  now name their outputs: `--ssl` adds the `.ssl` (off by default) and `--no-int` drops the `.int` (written
  by default), which also gives the SSL-only combination a spelling the old flag could not express.

  The `actions/tssl` inputs follow: `transpile: "true"` becomes `ssl: "true"`, and the new `int` input
  (default `true`) turns the bytecode off. With `int: "false"` the action drops the `opt` and
  `short-circuit` inputs, reporting that it did, since neither reaches an emitter that does not run.

- `types` is pinned empty, so the compile no longer discovers and binds every `@types/*` package reachable
  from the entry file. Ambient declarations from an installed `@types` package are no longer in scope in a
  `.tssl`, and a compile in a project that has them does less work.

## 0.1.0

First release.

- **Compiles TSSL to Fallout INT bytecode.** `tssl script.tssl` writes `script.int` - the TypeScript
  source becomes the compiler's IR directly, with no SSL text and no external compiler involved.
- **`--transpile`** also writes the readable `.ssl`, checked against a real corpus to compile to the same
  bytes.
- **`--opt <0|1|2>` and `-s`** select the optimisation level and short-circuit `and`/`or`.
- **`--check`** reports stale or missing output instead of writing it, and exits non-zero.
- **Syntax with no SSL equivalent is refused with its line**, never guessed at or copied through.

TSSL previously lived in `@bgforge/transpile` as one of the `fgtp` CLI's source types, emitting SSL text
only. Replace `fgtp src/ -r --save` with `tssl src/ -r --transpile`, or drop `--transpile` to get the
bytecode directly.
