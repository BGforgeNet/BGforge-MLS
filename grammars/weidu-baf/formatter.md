# WeiDU BAF Formatter

The WeiDU BAF formatter preserves the line-based structure of BAF files while normalizing indentation and comment spacing.

**Implementation:** [`../../server/src/weidu-baf/format/core.ts`](../../server/src/weidu-baf/format/core.ts)

> **Note:** When modifying the formatter implementation, update this documentation to reflect any behavior changes.

## Formatting Principles

### 1. Line-Based Structure Preservation

BAF files have a naturally line-based format (one trigger/action per line). The formatter preserves this structure:

```baf
IF
    ActionID("param1")
    ActionID2("param2")
THEN
    RESPONSE #100
        ActionID3("param3")
END
```

### 2. Indentation Normalization

- Consistent indentation (default 4 spaces, configurable via `.editorconfig`)
- Nested structures (IF/THEN blocks) get double indent
- Leading/trailing whitespace on lines is trimmed

### 3. Comment Handling

**Inline comments** (same line as code):

```baf
ActionID("param")  // This is preserved on the same line
```

**Standalone comments** (own line):

```baf
// This is a standalone comment
IF
```

**Block comments** (multi-line preserved):

```baf
/*
 * Multi-line block comment
 * Preserved exactly as written
 */
```

### 4. No Line Wrapping

Unlike D or TP2, BAF doesn't need line wrapping logic. The format is inherently line-based with no long expressions that need to be broken across lines.

## Examples

### Basic IF/THEN Block

**Input:**

```baf
IF     ActionID("param1")   ActionID2("param2")   THEN   RESPONSE   #100   ActionID3("param3")   END
```

**Formatted:**

```baf
IF
    ActionID("param1")
    ActionID2("param2")
THEN
    RESPONSE #100
        ActionID3("param3")
END
```

### Comments in Various Positions

```baf
// Comment before IF
IF
    ActionID("param1")  // Inline comment
    /* Block comment */ ActionID2("param2")
THEN
    RESPONSE #100
        /*
         * Multi-line
         * preserved
         */
        ActionID3("param3")
END

// Comment after END
```

### Nested Structures

```baf
IF
    Trigger1()
    IF
        Trigger2()
    THEN
        RESPONSE #50
            Action1()
    END
THEN
    RESPONSE #100
        Action2()
END
```

## Usage

### VSCode (LSP)

Format-on-save is automatic when enabled. Or use `Shift+Alt+F` / `Format Document`.

### CLI

```bash
# Format single file to stdout
node format-cli.js file.baf

# Format and save
node format-cli.js file.baf --save

# Format directory recursively
node format-cli.js path/to/dirs -r --save

# Check formatting (exit 1 if not formatted)
node format-cli.js file.baf --check
```

## Configuration

BAF formatter respects `.editorconfig` settings:

```ini
[*.baf]
indent_size = 4
```

## Related

- [WeiDU BAF Grammar README](./README.md) — BAF syntax reference
- [Format CLI](../../docs/architecture.md#format-cli) — General format CLI documentation
