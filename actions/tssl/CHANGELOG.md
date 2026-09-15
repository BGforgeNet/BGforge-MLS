# Changelog

Notable changes to the `actions/tssl` Action. Compiler changes: `compilers/tssl/CHANGELOG.md`.

## 1.0.3

- Fix: `check: true` fails on a generated `.ssl` that was never committed.

## 1.0.2

- Breaking: input `transpile` renamed `ssl`; the old name is ignored.
- `int: "false"` writes only the `.ssl`; `opt` and `short-circuit` are then ignored, with a log line.

## 1.0.1

- Compiles every `.tssl` under `paths` in one recursive run, so dependents of a changed module rebuild.
- Never commits `.int`; commits `.ssl` only with `transpile: "true"`.
- `check: true` compares the committed `.ssl` with a fresh compile.

## 1.0.0

- First release: compile `.tssl` with `@bgforge/tssl` and commit the `.int` (and `.ssl` with `transpile: "true"`).
