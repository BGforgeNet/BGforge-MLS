# WeiDU D Formatter

The WeiDU D formatter preserves comments exactly while normalizing code whitespace. It is used by both the LSP server (for format-on-save) and the standalone CLI (`format-cli.js`).

**Implementation:** [`../../server/src/weidu-d/format/core.ts`](../../server/src/weidu-d/format/core.ts)

> **Note:** When modifying the formatter implementation, update this documentation to reflect any behavior changes.

## Comment Preservation

### Decorative Separators

Decorative separator comments (`//////`) are preserved without adding space after `//`:

```d
///////////////////////////////////////////////////////////////////////
// This stays as-is
///////////////////////////////////////////////////////////////////////
```

**Not** formatted to:

```d
// /////////////////////////////////////////////////////////////////////
// This stays as-is
// /////////////////////////////////////////////////////////////////////
```

### Block Comments

Block comments (`/* */`) preserve all internal whitespace exactly:

```d
IF ~~ THEN REPLY @1 /* ~Oh, please.  I saw you.~ #123 */
```

Note the double space after the period is preserved.

### Trailing Comments

Trailing comments stay on the same line as code, not moved to new lines:

```d
REPLACE_SAY dlg 1 @1 /* comment */
END /* end of dialogue */
```

## Multi-line Strings

Multi-line tilde strings in transitions are formatted with proper indentation:

```d
EXTEND_BOTTOM dlg 0
    IF ~Global("x",
        "y")~ THEN REPLY @1 GOTO state
END
```

The formatter is **idempotent** — running it multiple times produces the same output.

## Whitespace Normalization

Code whitespace (outside strings and comments) is normalized:

- Multiple spaces → single space
- Leading/trailing whitespace on lines → trimmed
- Indentation → consistent based on `.editorconfig` or default (4 spaces)

## Complete Example

```d
///////////////////////////////////////////////////////////////////////
// Ascension : MELISS01
///////////////////////////////////////////////////////////////////////

EXTEND_BOTTOM MELISS01 12
    IF ~~ THEN REPLY @419 /* ~Oh, please.  I saw you coming.~ #74260 */ DO ~IncrementGlobal("Bhaal25Dream5","GLOBAL",-1)~ GOTO a18
    IF ~Global("BalthazarFights","GLOBAL",1)~ THEN REPLY @420 /* ~Well, your plan failed.~ #74263 */ GOTO a19
END

REPLACE_SAY MELISS01 14 @422 /* ~Do you dare come and face me there?~ #74259 */

APPEND MELISS01

    IF ~~ THEN BEGIN a18  // from: 12.6
        SAY @433 /* ~As long as you did what you were required.~ #74261 */
        IF ~Global("BalthazarFights","GLOBAL",1)~ THEN REPLY @420 GOTO a19
    END

END /* end of: APPEND MELISS01 */
```

All comments are preserved exactly as written.

## Usage

### VSCode (LSP)

Format-on-save is automatic when enabled in settings. Or use `Shift+Alt+F` / `Format Document`.

### CLI

```bash
# Format single file to stdout
node format-cli.js file.d

# Format and save
node format-cli.js file.d --save

# Format directory recursively
node format-cli.js path/to/dirs -r --save

# Check formatting (exit 1 if not formatted)
node format-cli.js file.d --check
```

## Related

- [WeiDU D Grammar README](./README.md) — D syntax reference
- [Format CLI](../../docs/architecture.md#format-cli) — General format CLI documentation
