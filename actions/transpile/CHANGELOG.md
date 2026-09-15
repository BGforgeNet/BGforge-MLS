# Changelog

Notable changes to the `actions/transpile` Action. CLI changes: `transpilers/CHANGELOG.md`.

## 1.0.3

- Breaking: `.tssl` dropped; use `actions/tssl`.
- README examples use `actions/checkout@v7`.

## 1.0.2

- `actions/setup-node` v6.5.0.

## 1.0.1

- Node.js 24 instead of 22.
- Fork PR guard skipped under `check: true`, so fork PRs can run the check.
- Fix: fork PR guard also covers `pull_request_target`.

## 1.0.0

- First release: regenerate or check (`check: true`) the output of changed `.tbaf`/`.td`/`.tssl` sources; an edited
  output maps back to its source.
