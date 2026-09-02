# `@bgforge/transpile`

TypeScript-to-scripting-language transpilers for classic RPG mod development:

- **TBAF** -> Infinity Engine BAF (AI scripts)
- **TD** -> Infinity Engine D (dialog files)

## Install

```bash
pnpm add @bgforge/transpile
# or
npm install @bgforge/transpile
```

Requires Node 20 or newer.

## Usage

### Dispatch by file extension

```ts
import { transpile } from "@bgforge/transpile";

const result = await transpile("mydialog.td", sourceText);
console.log(result.kind); // "td" | "tbaf"
console.log(result.output); // generated script
if (result.kind === "td") {
  console.log(result.warnings); // TD only
}
```

### Call a transpiler directly

```ts
import { tbaf, td } from "@bgforge/transpile";

const baf = await tbaf("script.tbaf", sourceText);
const dResult = await td("dialog.td", sourceText);
```

The named exports are direct re-exports of each transpiler's underlying function - no wrapping.

### Map generated lines back to the source

`tbafWithSourceMap` transpiles exactly as above and additionally returns `sourceMap`: for each 0-based line of the generated file, the absolute path and 0-based line the author wrote it on, or `undefined` for a line the transpiler emitted on its own. `td` already returns a result object, so it carries `sourceMap` without a separate entry point.

```ts
import { tbafWithSourceMap } from "@bgforge/transpile";

const { output, sourceMap } = await tbafWithSourceMap("script.tbaf", sourceText);
const origin = sourceMap[12]; // { file: "/mod/script.tbaf", line: 4 } | undefined
```

This is what lets a caller move an error reported against the generated file onto the line the author can act on - the SSL and WeiDU compilers only ever see the generated output.

### Errors

```ts
import { transpile, UnknownTranspileExtensionError } from "@bgforge/transpile";

try {
  await transpile("file.unknown", "");
} catch (err) {
  if (err instanceof UnknownTranspileExtensionError) {
    // err.message lists accepted extensions
  }
}
```

## `fgtp` CLI

Installing globally exposes the `fgtp` CLI:

```bash
pnpm add -g @bgforge/transpile
```

```
fgtp <file.td|file.tbaf|dir> [--save] [--check] [--save-and-check] [-r] [-q]
```

- `--save` - write the transpiled output alongside the source
  (`.td` -> `.d`, `.tbaf` -> `.baf`)
- `--check` - exit 1 if any output is not up to date
- `--save-and-check` - save and verify in one pass
- `-r` - recurse into directories
- `-q` - quiet mode (suppress summary)

Without `--save`, the transpiled output is printed to stdout.

### TSSL is not here

`.tssl` is compiled by [`@bgforge/tssl`](../compilers/tssl/), which installs its own `tssl` binary. It is
a compiler rather than a transpiler: its default output is Fallout INT bytecode with no intermediate SSL,
and emitting the readable `.ssl` is one option of it (`tssl --ssl`). See
[CHANGELOG](./CHANGELOG.md) 0.3.0 for the migration.

## Per-language transpiler guides

- [TBAF](./tbaf/docs/) - TypeScript to Infinity Engine BAF
- [TD](./td/docs/) - TypeScript to Infinity Engine D
