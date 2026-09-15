# Changelog

Notable changes to the `actions/binary` Action. CLI changes: `binary/CHANGELOG.md`.

## 1.0.7

- Description lists `.dlg`. Formats still come from `fgbin --extensions`.

## 1.0.6

- No change to the Action; README examples use `actions/checkout@v7`.

## 1.0.5

- `actions/setup-node` v6.5.0.

## 1.0.4

- No change; tagged with `@bgforge/binary` 0.4.0.

## 1.0.3

- Node.js 24 instead of 22.
- Fork PR guard skipped under `check: true`, so fork PRs can run the check.
- Fix: fork PR guard also covers `pull_request_target`.

## 1.0.2

- Fork PR error message shared with the other Actions. Description lists `.cre`.

## 1.0.1

- Push first, rebase only on rejection, instead of pulling every ref before each push.

## 1.0.0

- First release: refresh or check (`check: true`) JSON snapshots of changed binary files; full scan without a base
  commit.
