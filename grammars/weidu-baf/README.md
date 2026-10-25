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

**Note:** A response may hold no actions, and a block may hold no response (`IF ... THEN END`).

### Function Arguments

Functions can take various argument types:

| Type                  | Example              | Description                  |
| --------------------- | -------------------- | ---------------------------- |
| String (double quote) | `"text"`             | Standard string              |
| String (tilde)        | `~text~`             | Alternative string delimiter |
| Number                | `123`, `-5`, `-0x10` | Integer (decimal or hex)     |
| Hash number           | `#5`, `# 5`          | Integer, same as `5`         |
| Identifier            | `GLOBAL`, `Myself`   | Symbolic constant            |
| Object reference      | `[PC]`, `[ANYONE]`   | Special object               |
| Object with rectangle | `Player1[1.2.3.4]`   | Object plus a rectangle      |
| Point                 | `[100.200]`          | Coordinates x.y              |
| TRA reference         | `@123`               | Translation string reference |
| Variable reference    | `%varname%`          | WeiDU variable substitution  |
| Nested call           | `LastSeenBy(Myself)` | Function as argument         |

### Strings

Strings may span lines. There are no escape sequences. The forms:

```baf
DisplayString(Myself, "double quoted")
DisplayString(Myself, ~tilde quoted~)
DisplayString(Myself, %percent-quoted%)
DisplayString(Myself, ~~~~~five tildes may hold a ~ inside~~~~~)
DisplayString(Myself, ~male text~ [SOUND] ~female text~ [SOUND2])
Class(Myself, """""NAME BETWEEN FIVE QUOTES""""")
```

A `~text~` or `%text%` may be followed by a sound in brackets, and by a second text (the female one) with its own
sound; that is a `tlk_string` node. A comment marker inside a string is part of the string: `"// x"`. A string that
never closes reads on to the next delimiter, as the reference does. A percent text stops at whitespace, so a lone
`%` being typed cannot swallow the file. The five-quote form is a name, not a string.

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

Components are separated by `.`: names (`A-Z`, `a-z`, `0-9`, `_`, `-`, `#`, `!`), numbers, `%variables%`, or
`ANYONE`. The bracket may be empty (`[]`). A rectangle may follow an object, whatever its form:

```baf
See([ENEMY][1.2.3.4])
See(Player1[1.2.3.4])
```

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

A variable stands for a VALUE: a call name (`%RunAwayFrom%(...)`), an `OR` count, a bracket component, an
argument. A variable standing for a whole condition or action (`IF %COND%`, or `%action%` on a line of its own) is
structure, not a value, and is a syntax error, as it is for the reference.

### Overrides

`ActionOverride(Object, Action)` is a word of its own: it takes exactly an object and a call, and its closing
parenthesis may be left off. `TriggerOverride` is an ordinary call and needs its parenthesis.

### Comments

Block comments nest, so a commented-out block may hold comments of its own.

```baf
// Line comment

/* Block comment /* with another inside */ still the same comment */

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
