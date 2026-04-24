This directory contains source data for completion, hover, and signature help.

Base files are updated manually, others by scripts. See [docs/data-pipeline.md](../../docs/data-pipeline.md) for the full data flow diagram.

YAML format is chosen for its brevity compared to JSON, as well as possibility to use comments.

The data is processed into separate hover, completion, and signature JSON files by `scripts/generate-data.sh`, which invokes `scripts/utils/src/generate-data.ts`.

## YAML Schema

Each file contains one or more **stanzas**. A stanza groups items of the same [CompletionItemKind](https://docs.microsoft.com/en-us/dotnet/api/microsoft.visualstudio.languageserver.protocol.completionitemkind).

### Stanza

```yaml
stanza_name:
    type: 3 # CompletionItemKind (required, numeric)
    category: patch # Category override (optional, string)
    items: # Array of items (required)
        - name: ...
```

By default, the stanza name is used as the completion category identifier.
The optional `category` field overrides this, so items are filtered as if they
belong to the named category. This allows splitting a large stanza into smaller
groups (for distinct TextMate scoping) without proliferating completion filter
categories.

Stanza names also serve as category identifiers (unless `category` is set). The repository standard is `snake_case` for stanza names.

Rationale:

- Stanza names are consumed as string identifiers in TypeScript loaders, generators, tests, and derived JSON.
- `snake_case` aligns with the repo's grammar-oriented naming and avoids mixing YAML identifiers with JavaScript-style casing.
- A single identifier-oriented convention makes refactors and string-based lookups less error-prone while remaining easy to read in YAML.

This naming rule applies to YAML stanza/category identifiers only. Tree-sitter grammar rules and node types are a separate domain and should also use `snake_case`, following normal tree-sitter convention. Do not conflate YAML stanza renames with grammar-derived identifiers unless you are intentionally changing the grammar itself.

For TP2, callable stanza names (`action_functions`, `patch_functions`, `dimorphic_functions`, `action_macros`, `patch_macros`) determine the hover prefix (e.g., "action function", "patch macro").

Source-of-truth note:

- Canonical stanza/category strings live in [shared/stanza-names.ts](../../shared/stanza-names.ts).
- TP2 runtime-only completion categories that are not YAML stanzas (for example `action`, `patch`, `vars`) remain in [completion-context.ts](../src/shared/completion-context.ts).
- If you rename a stanza-backed TP2 category, update both places in the same change.

### Item fields

All fields except `name` are optional.

| Field        | Type              | Description                                                                                                          |
| ------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| `name`       | string            | Symbol name (required)                                                                                               |
| `detail`     | string            | Full signature string, e.g., `void foo()`. Deprecated in favor of `type` + `args`.                                   |
| `type`       | string            | Return type (Fallout: `int`, `void`, etc.) or callable context (WeiDU: `patch`, `action`, `dimorphic`)               |
| `args`       | array             | Structured parameter list (see below)                                                                                |
| `rets`       | array             | Return variables (WeiDU only, same structure as args)                                                                |
| `doc`        | string            | Markdown documentation                                                                                               |
| `deprecated` | boolean or string | Marks item as deprecated. `true` for a plain notice, or a string like `"Use new_func instead"` for a custom message. |

### Arg/Ret fields

```yaml
args:
    - name: param_name # Parameter name (required)
      type: int # Type: int, string, resref, bool, etc. (required)
      doc: description # Parameter documentation (optional)
      default: "0" # Default value (optional)
      required: true # Marks as required, hides default in hover (optional)
```

`default` and `required` may coexist on the same parameter. In WeiDU, all variables must be initialized before calling a function, so every parameter technically has a default (the WeiDU runtime zero-initializes INT*VAR to 0 and STR_VAR to ""). `required: true` is a semantic annotation on top of that: it signals that the caller \_must* set this parameter to a meaningful value — the default is present but not useful on its own (e.g. an empty resref or a name that selects nothing). The generator uses `required` to suppress the default in hover output, so users see it as a required field rather than an optional one with a default.

### Format detection

Items are classified as **WeiDU format** or **Fallout format** based on their content:

- **WeiDU format**: `type` is `patch`/`action`/`dimorphic`, or `rets` is present. Parameters render as INT_VAR/STR_VAR/RET tables with type links.
- **Fallout format**: everything else. Parameters render as a 2-column name/description table. Signature includes parenthesized args: `int func(int a, ObjectPtr b)`.

### Formatting pipeline

The build script uses shared building blocks from the server to produce consistent markdown:

| Building block             | Location                   | Used by                                            |
| -------------------------- | -------------------------- | -------------------------------------------------- |
| `buildWeiduHoverContent()` | `shared/tooltip-format.ts` | Build-time + runtime hover (WeiDU/TP2 composition) |
| `buildSignatureBlock()`    | `shared/tooltip-format.ts` | Build-time + runtime hover (code fence)            |
| `formatDeprecation()`      | `shared/tooltip-format.ts` | Build-time + runtime hover (deprecation notice)    |
| `buildWeiduTable()`        | `shared/tooltip-table.ts`  | Build-time + runtime hover (param table)           |
| `buildFalloutArgsTable()`  | `shared/tooltip-table.ts`  | Build-time hover only (Fallout arg table)          |

`buildWeiduHoverContent()` is the single composition function for all WeiDU/TP2 hover tooltips. It assembles the signature block, description (separated by `---`), parameter table, and deprecation notice. Both static data (from YAML) and dynamic data (from JSDoc-parsed headers) use it, ensuring identical formatting.

## Examples

### Fallout format (structured args)

```yaml
functions:
    type: 3
    items:
        - name: critter_mod_skill
          type: int
          args:
              - name: who
                type: ObjectPtr
                doc: Must be `dude_obj`.
              - name: skill
                type: int
                doc: "`SKILL_*` from `define.h`"
              - name: amount
                type: int
                doc: Can be negative.
          doc: |-
              Modifies a given skill by a given amount.
```

### Fallout format (detail string, deprecated)

```yaml
functions:
    type: 3
    items:
        - name: set_npc_stat_min
          detail: void set_npc_stat_min(int stat, int value)
          doc: |-
              Sets the minimum valid range on a stat.
```

### WeiDU format (structured args + rets)

```yaml
dimorphic_functions:
    type: 3
    items:
        - name: SUBSTRING
          type: dimorphic
          args:
              - name: start
                type: int
                doc: the string index to start from
              - name: length
                type: int
                doc: the length of the substring
              - name: string
                type: string
                doc: the source string
          rets:
              - name: substring
                type: string
                doc: the extracted substring
          doc: |-
              Returns a substring of the provided string.
```

### Simple keywords

```yaml
keywords:
    type: 14
    items:
        - name: IF
        - name: THEN
        - name: END
```
