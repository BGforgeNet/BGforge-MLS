# Changelog

Notable changes to the `actions/tssl` Action. Compiler changes: `compilers/tssl/CHANGELOG.md`.

## Unreleased

- Input `typecheck`, default `"true"`. From the `@bgforge/tssl` release after 0.4.0, the compiler type-checks each
  script against the `tsconfig.json` that includes it and refuses one with type errors, so a mod's CI fails on them.
  `typecheck: "false"` compiles without the check; 0.4.0 does not know the switch, so keep it on with that version.

## 1.1.0

- `actions/setup-node` v7.1.0.
- `version` defaults to `@bgforge/tssl` 0.4.0, the release this Action was tested with, instead of `latest`, so a
  pinned Action tag installs a known compiler. Set `version: latest` to keep the newest release on every run.
- Correction to 1.0.4: this Action has no changed-file list, since it compiles every `.tssl` under `paths`, and 1.0.3
  was not affected by the failure that entry describes. 1.0.4 changed nothing a run does.

## 1.0.4

- Fix: when the last file in the changed list no longer exists, such as one the push deleted, the step no longer
  fails with no message and no outputs.

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
