# Changelog

Notable changes to the `actions/format` Action. CLI changes: `format/CHANGELOG.md`.

## 1.0.4

- No change to the Action; README examples use `actions/checkout@v7`.

## 1.0.3

- `actions/setup-node` v6.5.0.

## 1.0.2

- No change; tagged with `@bgforge/format` 0.3.0.

## 1.0.1

- Node.js 24 instead of 22.
- Fork PR guard skipped under `check: true`, so fork PRs can run the check.
- Fix: fork PR guard also covers `pull_request_target`.

## 1.0.0

- First release: format or check (`check: true`) changed Fallout/WeiDU sources with `fgfmt`; full scan without a
  base commit.
