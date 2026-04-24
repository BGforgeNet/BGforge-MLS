# WeiDU TP2 Formatter

The WeiDU TP2 formatter handles the complex structure of TP2 mod installer files, including components, conditions, patches, and various action types.

**Implementation:** [`../../server/src/weidu-tp2/format/core.ts`](../../server/src/weidu-tp2/format/core.ts)

> **Note:** When modifying the formatter implementation, update this documentation to reflect any behavior changes.

## Formatting Principles

### 1. Component Structure (BEGIN Blocks)

Components are formatted with consistent structure:

```tp2
BEGIN ~Component Name~
    // Component content
    COPY ~file~ ~file~
        SAY name VALUE ~text~
    END
END
```

### 2. Top-Level Directives

Directives like `BACKUP`, `AUTHOR`, `VERSION` are normalized:

```tp2
BACKUP ~modname/backup~
AUTHOR ~Author Name~
VERSION 1.0
```

### 3. Conditions and ALWAYS Blocks

Conditions use standardized formatting:

```tp2
IF ~condition~ BEGIN
    // Content
END

ALWAYS
    // Always-executed content
END
```

**Compound conditions:**

```tp2
IF (FILE_EXISTS ~file1~ OR FILE_EXISTS ~file2~) BEGIN
    // Content
END
```

### 4. Copy Actions

**Basic copy:**

```tp2
COPY ~source~ ~destination~
    SAY name VALUE ~text~
    IF (condition) BEGIN
        action
    END
END
```

**Copy with patches:**

```tp2
COPY ~file~ ~file~
    PATCH_IF (condition) BEGIN
        WRITE_LONG 0x10 1
    END
END
```

### 5. Functions

**Function definitions:**

```tp2
FUNCTION MyFunction
    INPUT variable
    OUTPUT result
    BEGIN
        // Function body
    END
END
```

**Function calls:**

```tp2
SOLVE my_function (INPUT var1 OUTPUT var2)
```

### 6. Match Cases

Pattern matching with cases:

```tp2
MATCH variable
    CASE 1
        action1
    CASE 2
        action2
    DEFAULT
        default_action
END
```

### 7. Comment Handling

**Inline comments:** Two spaces before `//`:

```tp2
COPY ~file~ ~file~  // Comment on same line
```

**Standalone comments:**

```tp2
// This is a standalone comment
COPY ~file~ ~file~
```

**Block comments:** Preserved exactly:

```tp2
/*
 * Multi-line comment
 * Preserved as-is
 */
```

### 8. Indentation

- Consistent indentation (default 4 spaces, configurable via `.editorconfig`)
- Nested structures (BEGIN/END blocks) get incremental indent
- Leading/trailing whitespace trimmed

### 9. String Preservation

All string types are preserved exactly:

- Tilde strings: `~text~`
- Double-quote strings: `"text"`
- Multi-line strings (preserved with internal structure)

## Examples

### Complete Component

**Input:**

```tp2
BEGIN ~My Component~
COPY ~file1~ ~file1~
SAY name VALUE ~text~
IF (~condition~) BEGIN
WRITE_LONG 0x10 1
END
END
```

**Formatted:**

```tp2
BEGIN ~My Component~
    COPY ~file1~ ~file1~
        SAY name VALUE ~text~
        IF (~condition~) BEGIN
            WRITE_LONG 0x10 1
        END
    END
END
```

### Complex Conditions

```tp2
IF (~STR_VAR~ CONTAINS ~value~ AND FILE_EXISTS ~file~) BEGIN
    COPY ~src~ ~dst~
        PATCH_IF (~condition~) BEGIN
            WRITE_BYTE 0x00 1
        END
    END
END

ALWAYS
    LPRINTF ~Always executed~
END
```

### Functions

```tp2
FUNCTION MyFunction
    INPUT var1
    OUTPUT result
    BEGIN
        MATCH var1
            CASE 1
                result := 100
            CASE 2
                result := 200
            DEFAULT
                result := 0
        END
    END
END

SOLVE my_function (INPUT my_var OUTPUT my_result)
```

### Patches and Replace

```tp2
COPY ~item~ ~item~
    REPLACE_BCS_BLOCK
        IF
            Action()
        THEN
            RESPONSE #100
                Action2()
        END
    END
END
```

### Comments in Various Positions

```tp2
// Component comment
BEGIN ~Component~  // Inline comment
    /*
     * Multi-line preserved
     */
    COPY ~file~ ~file~  // Copy comment
        SAY name VALUE ~text~
    END
END
```

## Usage

### VSCode (LSP)

Format-on-save is automatic when enabled. Or use `Shift+Alt+F` / `Format Document`.

### CLI

```bash
# Format single file to stdout
node format-cli.js file.tp2

# Format and save
node format-cli.js file.tp2 --save

# Format directory recursively
node format-cli.js path/to/dirs -r --save

# Check formatting (exit 1 if not formatted)
node format-cli.js file.tp2 --check
```

## Configuration

TP2 formatter respects `.editorconfig` settings:

```ini
[*.tp2]
indent_size = 4
```

## Special Cases

### STR_VAR Conditions

String variable conditions are preserved with exact spacing:

```tp2
IF (~STR_VAR~ CONTAINS ~value~) BEGIN
```

### Inlined Files

Inlined file content preserves its internal formatting:

```tp2
COPY ~file~ ~file~
    INLINED_FILE
        // Content preserved as-is
    END
END
```

## Related

- [WeiDU TP2 Grammar README](./README.md) — TP2 syntax reference
- [Format CLI](../../docs/architecture.md#format-cli) — General format CLI documentation
