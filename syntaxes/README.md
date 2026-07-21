Do not edit JSON files.

All syntaxes here are written in `yml` and converted to `json` with `scripts/syntaxes-to-json.sh`. That script is launched manually on demand.

YAML is easier to maintain, because it's less verbose and allows comments.

## Contents

Four categories of grammars:

- **12 primary language grammars** - syntax highlighting for each supported language
- **4 tooltip grammars** - hover rendering (used by VSCode tooltip panels)
- **3 injection grammars** - comments, strings, docstrings (injected into primary grammars)
- **1 webview tokenizer grammar** - `dialog-tsexpr`, embedded TS-expression highlighting in the dialog
  editor webview; consumed directly by the webview bundle, not registered in `contributes.grammars`

See [docs/architecture.md](../docs/architecture.md#textmate-grammars) for architecture details.
