# `@bgforge/transpile`

TypeScript-to-scripting-language transpilers for classic RPG mod development:

- **TSSL** → Fallout SSL
- **TBAF** → Infinity Engine BAF (AI scripts)
- **TD** → Infinity Engine D (dialog files)

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
console.log(result.kind); // "td" | "tbaf" | "tssl"
console.log(result.output); // generated script
if (result.kind === "td") {
    console.log(result.warnings); // TD only
}
```

### Call a transpiler directly

```ts
import { tssl, tbaf, td } from "@bgforge/transpile";

const ssl = await tssl("script.tssl", sourceText);
const baf = await tbaf("script.tbaf", sourceText);
const dResult = await td("dialog.td", sourceText);
```

The named exports are direct re-exports of each transpiler's underlying function — no wrapping. Pass any extra arguments the underlying function accepts (e.g. TSSL's optional `batchState` for cross-file inline-function caching).

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
fgtp <file.td|file.tbaf|file.tssl|dir> [--save] [--check] [--save-and-check] [-r] [-q]
```

- `--save` — write the transpiled output alongside the source
  (`.td` → `.d`, `.tbaf` → `.baf`, `.tssl` → `.ssl`)
- `--check` — exit 1 if any output is not up to date
- `--save-and-check` — save and verify in one pass
- `-r` — recurse into directories
- `-q` — quiet mode (suppress summary)

Without `--save`, the transpiled output is printed to stdout.

## Per-language transpiler guides

- [TSSL](./tssl/docs/) — TypeScript to Fallout SSL
- [TBAF](./tbaf/docs/) — TypeScript to Infinity Engine BAF
- [TD](./td/docs/) — TypeScript to Infinity Engine D
