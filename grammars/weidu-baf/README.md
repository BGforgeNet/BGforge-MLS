# tree-sitter-baf

Tree-sitter grammar for WeiDU BAF (Infinity Engine script format).

## BAF Syntax Reference

BAF (Baldur's Gate Action File) is a script format used by Infinity Engine games (Baldur's Gate, Icewind Dale, Planescape: Torment).

### Basic Structure

A BAF file consists of one or more blocks:

```baf
IF
  condition1()
  condition2()
THEN
  RESPONSE #weight
    action1()
    action2()
END
```

### Keywords

Keywords are case-insensitive: `IF`, `if`, `If` are all valid.

- `IF` - starts condition block
- `THEN` - starts response block
- `RESPONSE` - defines a response with weight
- `END` - ends the block
- `OR(N)` - groups next N conditions with OR logic

### Conditions

Conditions are function calls that return true/false:

```baf
IF
  Global("varname", "SCOPE", 1)
  !Dead("creature")              // Negation with !
THEN
```

**Negation:** Only single `!` is allowed. Double negation `!!` is invalid.

### OR Groups

`OR(N)` groups the next N conditions:

```baf
IF
  OR(2)
    Class(Player1, MAGE)
    Class(Player1, SORCERER)
  Global("quest", "GLOBAL", 1)   // AND with OR group above
THEN
```

### Responses

Each response has a weight (for random selection) and one or more actions:

```baf
THEN
  RESPONSE #100
    SetGlobal("var", "GLOBAL", 1)
    Continue()
  RESPONSE #50
    DisplayString(Myself, ~Half chance~)
END
```

**Note:** A response must have at least one action. Empty responses are invalid.

### Function Arguments

Functions can take various argument types:

| Type                  | Example              | Description                  |
| --------------------- | -------------------- | ---------------------------- |
| String (double quote) | `"text"`             | Standard string              |
| String (tilde)        | `~text~`             | Alternative string delimiter |
| Number                | `123`, `-5`, `0xFF`  | Integer (decimal or hex)     |
| Identifier            | `GLOBAL`, `Myself`   | Symbolic constant            |
| Object reference      | `[PC]`, `[ANYONE]`   | Special object               |
| Point                 | `[100.200]`          | Coordinates x.y              |
| TRA reference         | `@123`               | Translation string reference |
| Variable reference    | `%varname%`          | WeiDU variable substitution  |
| Nested call           | `LastSeenBy(Myself)` | Function as argument         |

### Strings

Two string delimiters are supported:

```baf
DisplayString(Myself, "double quoted")
DisplayString(Myself, ~tilde quoted~)
```

Strings are single-line only. No escape sequences.

### Points (Coordinates)

Points use `[x.y]` notation:

```baf
CreateCreature("goblin", [1234.5678], 0)
MoveToPoint([100.200])
```

Points can use variable references:

```baf
CreateCreature("goblin", [%x%.%y%], 0)
```

### Object References

Special object identifiers in brackets:

```baf
See([PC])
See([ANYONE])
Detect([ENEMY])
```

Valid characters: `A-Z`, `a-z`, `0-9`, `_`, `.`

### TRA References

Translation string references for WeiDU:

```baf
DisplayString(Myself, @123)
```

No spaces between `@` and number. Negative numbers are invalid.

### Variable References

WeiDU variable substitution:

```baf
SetGlobal(%variable_name%, "GLOBAL", 1)
```

No spaces inside `%...%`. Variables follow identifier rules.

### Comments

```baf
// Line comment

/* Block comment */

IF
  True()  // Inline comment
THEN
```

## Building

```bash
pnpm build
```

Or manually:

```bash
tree-sitter generate
tree-sitter build --wasm
```

## Testing

Parse test samples:

```bash
tree-sitter parse test/samples/*.baf
```

Run grammar tests, including formatter sample verification:

```bash
pnpm test
```

## Formatter

See [formatter.md](./formatter.md) for complete documentation on the WeiDU BAF formatter.

## Grammar Notes

### Ambiguity Resolution

`point` rule is ordered before `object_ref` in `_argument` to correctly parse `[0.0]` as a point rather than an object reference.

### Token Boundaries

`tra_ref` and `variable_ref` use `token()` to prevent whitespace inside:

- `@ 123` - invalid (space)
- `@123` - valid
- `% var %` - invalid (spaces)
- `%var%` - valid
