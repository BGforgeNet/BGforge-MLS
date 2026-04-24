# Writing TBAF

TBAF is a TypeScript subset that transpiles to BAF (Infinity Engine AI scripts). You write `.tbaf` files using standard TypeScript syntax, and the transpiler converts them to `.baf` files that WeiDU then compiles into the game. TBAF gives you type checking, autocomplete, and module imports while generating the flat `IF/THEN/END` blocks that the engine requires.

## Core Concept

BAF has no variables, loops, or functions at runtime. An AI script is a sequence of `IF condition THEN action END` blocks. The engine evaluates them top to bottom and executes the first matching block. TBAF lets you use TypeScript abstractions that **expand entirely at compile time** into those flat blocks.

```typescript
// TBAF input
const enemies = ["Player1", "Player2"];
for (const enemy of enemies) {
    if (See(enemy)) {
        Attack(enemy);
    }
}
```

```
// BAF output
IF
  See(Player1)
THEN
  RESPONSE #100
    Attack(Player1)
END

IF
  See(Player2)
THEN
  RESPONSE #100
    Attack(Player2)
END
```

Every TBAF construct -- variables, functions, loops, enums -- is resolved at compile time. Nothing survives to the BAF output except `IF/THEN/END` blocks.

## Supported Syntax

### Variables

**`const` and `let`** define compile-time constants. Their values are substituted into the output wherever the variable name appears:

```typescript
const TARGET = "Player1";
const SPELL = "WIZARD_SHIELD";

if (See(TARGET)) {
    Spell(Myself, SPELL);
}
// -> IF See(Player1) THEN Spell(Myself, WIZARD_SHIELD) END
```

Variables hold string or number values and are substituted textually. There are no runtime variables in BAF.

### Functions

User-defined functions are **inlined at call sites**. They do not emit BAF constructs -- their body is expanded wherever they are called.

```typescript
function attackIfVisible(target: string) {
    if (See(target)) {
        Attack(target);
    }
}

attackIfVisible("Player1");
attackIfVisible("Player2");
```

This produces two `IF/THEN/END` blocks, one per call, with the parameter substituted.

Functions can contain conditions, actions, and control flow. All parameters are substituted at compile time:

```typescript
function buffAndAttack(target: string, spell: string) {
    if (See(target)) {
        Spell(Myself, spell);
        Attack(target);
    }
}

buffAndAttack("Player1", "WIZARD_SHIELD");
```

**Condition functions** return a boolean expression. The return expression is inlined as a condition:

```typescript
function isHostile(target: string) {
    return See(target) && !InParty(target);
}

if (isHostile("Player1")) {
    Attack(Player1);
}
// -> IF See(Player1) !InParty(Player1) THEN Attack(Player1) END
```

**Constraint:** Functions used inside OR groups must return a single condition. A function returning `A() && B()` (multiple ANDed conditions) cannot be used as an OR element because BAF OR groups only accept individual conditions.

### Control Flow: `if` / `else if` / `else`

Each branch becomes a separate `IF/THEN/END` block. The `else` branch accumulates the negation of all prior conditions:

```typescript
if (See(Player1)) {
    Attack(Player1);
} else if (See(Player2)) {
    Attack(Player2);
} else {
    NoAction();
}
```

Output:

```
IF
  See(Player1)
THEN
  RESPONSE #100
    Attack(Player1)
END

IF
  !See(Player1)
  See(Player2)
THEN
  RESPONSE #100
    Attack(Player2)
END

IF
  !See(Player1)
  !See(Player2)
THEN
  RESPONSE #100
    NoAction()
END
```

Nested `if` inside `if` accumulates parent conditions:

```typescript
if (See(Player1)) {
    if (Global("aggressive", "LOCALS", 1)) {
        Attack(Player1);
    }
}
// -> IF See(Player1) Global("aggressive", "LOCALS", 1) THEN Attack(Player1) END
```

### Operators: `&&`, `||`, `!`

**`&&` (AND)** maps to multiple conditions in the same IF block (BAF's implicit AND):

```typescript
if (See(Player1) && Global("hostile", "LOCALS", 1)) {
    Attack(Player1);
}
// -> IF See(Player1) Global("hostile", "LOCALS", 1) THEN ... END
```

**`||` (OR)** maps to BAF's `OR(n)` construct:

```typescript
if (See(Player1) || See(Player2)) {
    Attack(NearestEnemyOf(Myself));
}
// -> IF OR(2) See(Player1) See(Player2) THEN ... END
```

**`!` (NOT)** negates the condition:

```typescript
if (!See(Player1)) {
    NoAction();
}
// -> IF !See(Player1) THEN ... END
```

### How `else` Negates Conditions

BAF conditions are a list of AND clauses, where each clause is a single condition or an OR group. The transpiler converts `else` branches by negating the prior conditions:

**Simple cases work directly:**

- `A && B` -- two AND conditions
- `A || B` -- one OR(2) group
- `A && (B || C)` -- one AND condition plus one OR(2) group

**`else` branch negation:**

- `else` after `if (A && B)` becomes `OR(2) !A !B`
- `else` after `if (A || B)` becomes `!A !B` (two AND conditions)

**Avoid deeply nested negations.** If the condition is too complex for the transpiler to invert into valid BAF, it will error. Simplify the condition -- break it into multiple `if/else if` branches with simpler tests.

### `switch` / `case`

Each case becomes a separate `IF/THEN/END` block. The switch expression must be a function call (typically `Global()` or similar):

```typescript
const state = Global("state", "LOCALS");
switch (state) {
    case 0:
        ActionA();
        break;
    case 1:
        ActionB();
        break;
}
```

Output:

```
IF
  Global("state", "LOCALS", 0)
THEN
  RESPONSE #100
    ActionA()
END

IF
  Global("state", "LOCALS", 1)
THEN
  RESPONSE #100
    ActionB()
END
```

The case value is appended as the last argument to the switch expression's function call. This is how BAF condition functions work -- `Global("name", "scope", value)` checks if the variable equals `value`.

**`default` is not allowed.** BAF cannot express "none of the above" as a single condition. Use explicit cases or `if/else` instead.

### `for` Loops (Compile-Time Unrolled)

Standard `for` loops are unrolled at compile time:

```typescript
for (let i = 0; i < 3; i++) {
    GiveItemCreate("POTN08", Player1, 1, 0, 0);
}
```

Produces three copies of the action block. The loop variable is substituted into the body.

Supported incrementors: `i++`, `i--`, `i += N`, `i -= N`.

Maximum iterations: **1000**. Exceeding this throws an error.

### `for...of` Loops (Compile-Time Unrolled)

Iterate over compile-time arrays:

```typescript
const enemies = ["Player1", "Player2", "Player3"];
for (const enemy of enemies) {
    if (See(enemy)) {
        Attack(enemy);
    }
}
```

Produces one `IF/THEN/END` block per array element with the variable substituted.

**Array destructuring** is supported:

```typescript
const buffs: [string, string][] = [
    ["Player1", "WIZARD_SHIELD"],
    ["Player2", "WIZARD_ARMOR"],
];

for (const [target, spell] of buffs) {
    if (See(target)) {
        Spell(Myself, spell);
    }
}
```

### Arrays

Arrays are compile-time only. Spread is supported:

```typescript
const base = ["Player1", "Player2"];
const all = [...base, "Player3", "Player4"];

for (const target of all) {
    if (See(target)) {
        Attack(target);
    }
}
```

### Point Arguments

BAF uses dot-separated `[x.y]` notation for coordinate points. In TBAF, use standard TypeScript tuples `[number, number]` and the transpiler converts them automatically:

```typescript
if (True()) {
    CreateCreature("ccguard2", [2791, 831], 6);
}
// -> CreateCreature("ccguard2", [2791.831], 6)
```

Negative coordinates are supported (e.g. `[-1, -1]` for "current location"):

```typescript
CreateCreature("g_spy1", [-1, -1], 0);
// -> CreateCreature("g_spy1", [-1.-1], 0)
```

Point tuples work through variable substitution, function inlining, and loop unrolling:

```typescript
const positions: [string, [number, number]][] = [
    ["ccguard1", [100, 200]],
    ["ccguard2", [300, 400]],
];

for (const [resref, pos] of positions) {
    if (True()) {
        CreateCreature(resref, pos, 0);
    }
}
```

Only two-element numeric arrays are converted. Three-element arrays like `[1, 2, 3]` and object identifiers like `[PC]` are left unchanged.

### Enums

Numeric and string enums. Property access is substituted at compile time:

```typescript
enum Spell {
    Shield = "WIZARD_SHIELD",
    Armor = "WIZARD_ARMOR",
}

if (See(Player1)) {
    Spell(Myself, Spell.Shield);
}
// -> IF See(Player1) THEN Spell(Myself, WIZARD_SHIELD) END
```

Enums from iets `.d.ts` files have their prefix stripped: `ClassID.ANKHEG` becomes `ANKHEG`.

### `@tra` Tag

Set the translation file for WeiDU:

```typescript
/** @tra smarter_mages.tra */
```

Must be in a JSDoc comment (`/** ... */`).

## Imports

Engine builtins (triggers, actions, objects, constants) come from [IETS](https://github.com/BGforgeNet/iets):

```typescript
import { See, Attack, Global, SetGlobal } from "@bgforge/iets/baf.d";
import { Player1, Myself } from "@bgforge/iets/objects.d";
import { ClassID } from "@bgforge/iets/class.ids";
```

Local `.ts` and `.tbaf` files can also be imported:

```typescript
import { myHelper } from "./helpers";
import { sharedArray } from "./data.tbaf";
```

## Scope Constants

`GLOBAL`, `LOCALS`, and `MYAREA` are auto-quoted in the output:

```typescript
SetGlobal("hostile", LOCALS, 1);
// -> SetGlobal("hostile", "LOCALS", 1)
```

Don't wrap them in quotes yourself -- they are quoted automatically.

## Forbidden Syntax

| Syntax                         | Reason                                     |
| ------------------------------ | ------------------------------------------ |
| `default` in `switch`          | BAF cannot express "none of the above"     |
| Negating complex OR groups     | Too complex to represent in BAF conditions |
| Arrow functions `() => {}`     | Not supported                              |
| Classes, `async`/`await`       | No runtime constructs in BAF               |
| `try`/`catch`/`finally`        | No error handling in BAF                   |
| Template literals `` `${x}` `` | Not supported                              |
| Object literals                | Not meaningful in BAF context              |

## Gotchas and Pitfalls

1. **All evaluation is compile-time.** Variables do not exist at runtime. `const x = 5; if (x > 3)` is evaluated by the transpiler, not the engine. The `if` either always produces a block or never does.

2. **Loop iteration limit.** The maximum is 1000 iterations. BAF scripts should not need many iterations -- if you hit this limit, the script likely has a design issue.

3. **Scope constants are auto-quoted.** `GLOBAL`, `LOCALS`, `MYAREA` become `"GLOBAL"`, `"LOCALS"`, `"MYAREA"` in the output. Don't quote them yourself.

4. **Function inlining constraints.** A function used inside an OR group must return exactly one condition. A function returning `A && B` (two conditions) cannot be an OR element. A function returning an OR group cannot be nested inside another OR group.

5. **Switch expression must be a function call.** `switch (Global("x", "LOCALS"))` works. `switch (someVariable)` does not -- BAF conditions are function calls, not comparisons.

6. **Variables in loops are cleaned up.** After a `for` or `for...of` loop completes, the loop variable is deleted from the compile-time context. This prevents stale values from leaking into later code.

7. **RESPONSE #100.** All emitted blocks use `RESPONSE #100` (100% probability). Weighted responses are not supported. Use conditions to select between alternatives.

## Compilation

```
.tbaf -> transpiler -> .baf -> WeiDU -> game
```

Press Ctrl+R in VSCode or use the transpile CLI to compile.
