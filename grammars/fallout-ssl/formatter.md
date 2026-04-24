# Fallout SSL Formatter

The Fallout SSL formatter preserves code structure while normalizing indentation, whitespace, and comment formatting. It handles both regular code and preprocessor directives.

**Implementation:** [`../../server/src/fallout-ssl/format/core.ts`](../../server/src/fallout-ssl/format/core.ts)

> **Note:** When modifying the formatter implementation, update this documentation to reflect any behavior changes.

## Formatting Principles

### 1. Procedure and Macro Formatting

Procedures and macros are formatted with consistent structure:

```ssl
procedure MyProcedure(source_obj, target_obj)
begin
    // Procedure body
    call OtherProc(source_obj);
end

#define MyMacro(x)
    begin
        display_msg(x);
    end
```

### 2. Control Flow Statements

Control flow statements use standardized formatting:

**If statements:**

```ssl
if (condition) then
    // body
else if (other_condition) then
    // body
else
    // body
end
```

**While loops:**

```ssl
while (condition) do
    // body
end
```

**For/foreach loops:**

```ssl
for (i = 0; i < 10; i += 1) do
    // body
end

foreach (item in list) do
    // body
end
```

**Switch statements:**

```ssl
switch (value)
    case 1:
        // body
        break
    case 2:
        // body
        break
    default:
        // body
end
```

### 3. Expression Formatting

**Function calls:**

```ssl
call MyFunction(arg1, arg2, arg3);
```

**Assignments:**

```ssl
variable := expression;
```

**Operators:** Spaces around binary operators:

```ssl
if (x + 5 > y * 2) then
```

### 4. Comment Handling

**Line comments:**

```ssl
// Single line comment
```

**Block comments:**

```ssl
/*
 * Multi-line block comment
 * Preserved with original structure
 */
```

**Inline comments:** Two spaces before `//`:

```ssl
call MyFunction();  // Inline comment
```

**Preprocessor comments:** Preserved on same line:

```ssl
#define MAX_VALUE 100  // Maximum allowed value
```

### 5. Preprocessor Directives

Directives are normalized with consistent spacing:

```ssl
#define NAME value
#define MACRO(x) (x * 2)
#ifdef SYMBOL
// code
#endif

#include "header.ssl"
```

### 6. Indentation

- Consistent indentation (default 4 spaces, configurable via `.editorconfig`)
- Nested structures get incremental indent
- Leading/trailing whitespace trimmed

## Examples

### Complete Procedure Example

**Input:**

```ssl
procedure  CombatAttack(attacker,defender)
begin
if (attacker != 0)  then
call AttackRoutine(attacker,defender);
else
display_msg("No attacker");
end
end
```

**Formatted:**

```ssl
procedure CombatAttack(attacker, defender)
begin
    if (attacker != 0) then
        call AttackRoutine(attacker, defender);
    else
        display_msg("No attacker");
    end
end
```

### Comments Preservation

```ssl
///////////////////////////////////////////////////////////////////////
// Combat module
///////////////////////////////////////////////////////////////////////

procedure MyProc()
begin
    // Single line comment
    call Func1();

    /*
     * Multi-line preserved
     * exactly as written
     */
    call Func2();

    call Func3();  // Inline comment stays on same line

    #define LOCAL_CONSTANT 42  // Preprocessor with comment
end
```

### Control Flow

```ssl
procedure Example(obj)
begin
    if (obj != 0) then
        if (IsAlive(obj)) then
            call Attack(obj);
        else
            display_msg("Target is dead");
        end
    end

    while (HasAmmo(weapon)) do
        call Fire(weapon);
        ammo -= 1;
    end

    foreach (enemy in enemy_list) do
        if (IsHostile(enemy)) then
            call Target(enemy);
        end
    end
end
```

## Usage

### VSCode (LSP)

Format-on-save is automatic when enabled. Or use `Shift+Alt+F` / `Format Document`.

### CLI

```bash
# Format single file to stdout
node format-cli.js file.ssl

# Format and save
node format-cli.js file.ssl --save

# Format directory recursively
node format-cli.js path/to/dirs -r --save

# Check formatting (exit 1 if not formatted)
node format-cli.js file.ssl --check
```

## Configuration

SSL formatter respects `.editorconfig` settings:

```ini
[*.ssl]
indent_size = 4
```

## Special Cases

### Reserved Words as Identifiers

The formatter detects when SSL reserved words are used as identifiers and reports them as errors rather than attempting to format invalid code.

### Macro Definitions

Multi-line macro definitions with backslash continuation are preserved:

```ssl
#define COMPLEX_MACRO(x, y)
    begin
        local a := x + y;
        local b := x - y;
        return a * b;
    end
```

## Related

- [Fallout SSL Grammar README](./README.md) — SSL syntax reference
- [Format CLI](../../docs/architecture.md#format-cli) — General format CLI documentation
