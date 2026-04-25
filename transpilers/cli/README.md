# `@bgforge/fgtp`

Standalone CLI for transpiling BGforge TypeScript-based modding sources:

- `.tssl` -> `.ssl`
- `.tbaf` -> `.baf`
- `.td` -> `.d`

## Install

```bash
pnpm add -g @bgforge/fgtp
```

## Usage

```bash
fgtp <file.td|file.tbaf|file.tssl|dir> [--save] [--check] [-r] [-q]
```

Examples:

```bash
fgtp mydialog.td
fgtp mydialog.td --save
fgtp src/ -r --save
fgtp src/ -r --check
```
