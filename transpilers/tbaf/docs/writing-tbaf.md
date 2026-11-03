# Writing TBAF

TBAF is a TypeScript subset that transpiles to BAF (Infinity Engine AI scripts). You write `.tbaf` files using standard TypeScript syntax, and the transpiler converts them to `.baf` files that WeiDU then compiles into the game. TBAF gives you type checking, autocomplete, and module imports while generating the flat `IF/THEN/END` blocks that the engine requires.

## Core Concept

BAF has no variables, loops, or functions at runtime. An AI script is a sequence of `IF condition THEN action END` blocks. The engine evaluates them top to bottom and executes the first matching block. TBAF lets you use TypeScript abstractions that **expand entirely at compile time** into those flat blocks.

```typescript
// TBAF input
const enemies = [Player1, Player2];
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

Every action sits inside an `if` or `switch`, which gives its block the condition it runs under. An action outside one is an error: its block would match on every pass, and no block after it would ever run.

## Supported Syntax

### Variables

**`const`** defines a compile-time value. Its initializer is evaluated as TypeScript evaluates it, and the result is written wherever the name is used:

```typescript
const TARGET = Player1;
const SPELL = WIZARD_SHIELD;
const LIMIT = 10 * 2 + 1;

if (See(TARGET) && GlobalLT("count", "LOCALS", LIMIT)) {
  Spell(Myself, SPELL);
}
// -> IF See(Player1) GlobalLT("count", "LOCALS", 21) THEN Spell(Myself, WIZARD_SHIELD) END
```

There are no runtime variables in BAF, so a value cannot change: `let` and `var` are errors (`let` stays for a `for` loop's counter), and so is an assignment. Names follow TypeScript's scoping: a constant declared in a function or block belongs to it.

### Compile-time values

A value is an integer, a string, an array or an object, worked out before the output is written:

- Integers: `+ - * %`, bitwise operators, comparisons and `? :`. BAF reads 32-bit integers only, so a fraction (`1.5`) is an error, and so is a result past 32 bits. `/` must divide exactly; for integer division write `Math.trunc(a / b)` or `Math.floor(a / b)`. `Math.ceil`, `Math.abs`, `Math.min` and `Math.max` work too.
- Strings: `+` and template literals join strings and integers: `` `SPWI${n}` ``.
- Arrays and objects: indexing (`arr[1]`), `.length`, fields (`cfg.id`) and spread. They exist at compile time only; an argument takes one of their values, or a pair of integers as a point.
- A name the source does not declare is an engine name (`Myself`, an IDS symbol), written as it is. The CLI's type check catches a misspelled one.

### Functions

User-defined functions are **inlined at call sites**. They do not emit BAF constructs -- their body is expanded wherever they are called.

```typescript
function attackIfVisible(target: ObjectPtr) {
  if (See(target)) {
    Attack(target);
  }
}

attackIfVisible(Player1);
attackIfVisible(Player2);
```

This produces two `IF/THEN/END` blocks, one per call, each with the call's argument in place of the parameter.

Functions can contain conditions, actions, and control flow. Each parameter is bound to its argument's value, or its default:

```typescript
function buffAndAttack(target: ObjectPtr, spell: SpellID) {
  if (See(target)) {
    Spell(Myself, spell);
    Attack(target);
  }
}

buffAndAttack(Player1, WIZARD_SHIELD);
```

**Condition functions** return a boolean expression, which is inlined as a condition. Their body is `const` declarations followed by one `return`:

```typescript
function isHostile(target: ObjectPtr) {
  return See(target) && !InParty(target);
}

if (isHostile(Player1)) {
  Attack(Player1);
}
// -> IF See(Player1) !InParty(Player1) THEN Attack(Player1) END
```

A function returning `A() && B()` works inside an OR group too: see [How `else` Negates Conditions](#how-else-negates-conditions) for how such a condition is written in BAF.

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

**An `&&` inside an `||`** is distributed, since an OR group holds single conditions only: `A || (B && C)` becomes `OR(2) A B` and `OR(2) A C`. A condition that would distribute into more than 128 groups is an error; split it into `if/else if` branches.

**A compile-time part of a condition is decided now.** `const x = 1; if (x > 3)` produces no block at all, and a part that is always true drops out: `if (Global("g", "GLOBAL", 1) && x === 1)` tests `Global` alone.

### `switch` / `case`

Each case becomes a separate `IF/THEN/END` block. The switch expression must be a function call (typically `Global()` or similar), written without the value each `case` supplies. iets declares that form of `Global(name, scope)` from 0.6.0, so the type check accepts it:

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

Empty cases stacked above one with statements share its block, as an OR group: `case 0: case 1: ActionA(); break;` tests `OR(2) Global("state", "LOCALS", 0) Global("state", "LOCALS", 1)`. A case with statements ends with `break`; one that falls through into the next is an error.

**`default` is not allowed.** BAF cannot express "none of the above" as a single condition. Use explicit cases or `if/else` instead.

### `for` Loops (Compile-Time Unrolled)

Standard `for` loops are unrolled at compile time:

```typescript
if (Global("gift", "LOCALS", 0)) {
  for (let i = 0; i < 3; i++) {
    GiveItemCreate("POTN08", Player1, 1, 0, 0);
  }
  SetGlobal("gift", "LOCALS", 1);
}
```

Produces one block with three `GiveItemCreate` actions, then the `SetGlobal`. The counter holds its value in each pass of the body.

Supported incrementors: `i++`, `i--`, `i += N`, `i -= N`, `i = expr`.

Maximum iterations: **1000**. Exceeding this throws an error.

### `for...of` Loops (Compile-Time Unrolled)

Iterate over compile-time arrays:

```typescript
const enemies = [Player1, Player2, Player3];
for (const enemy of enemies) {
  if (See(enemy)) {
    Attack(enemy);
  }
}
```

Produces one `IF/THEN/END` block per array element, the loop variable holding that element.

**Array destructuring** is supported:

```typescript
const buffs: [ObjectPtr, SpellID][] = [
  [Player1, WIZARD_SHIELD],
  [Player2, WIZARD_ARMOR],
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
const base = [Player1, Player2];
const all = [...base, Player3, Player4];

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
if (Global("spawn", "LOCALS", 0)) {
  CreateCreature("g_spy1", [-1, -1], 0);
}
// -> CreateCreature("g_spy1", [-1.-1], 0)
```

Point tuples work through constants, function arguments, and loop variables:

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

Only a pair of integers becomes a point; any other array in an argument is an error. An object specifier such as `[PC]` is an array to TypeScript, so write it as `obj("[PC]")`.

### Enums

Numeric and string enums. A member access is replaced by the member's value:

```typescript
enum Mode {
  Idle = 0,
  Hunting = 1,
}

if (Global("mode", "LOCALS", Mode.Hunting)) {
  SetGlobal("mode", "LOCALS", Mode.Idle);
}
// -> IF Global("mode", "LOCALS", 1) THEN SetGlobal("mode", "LOCALS", 0) END
```

A string member is written as a quoted string. An enum may not share a name with an action or trigger it is used beside (`enum Spell` next to `Spell(...)`): TypeScript reads the call as calling the enum.

Enums from iets `.d.ts` files have their prefix stripped: `CLASS.ANKHEG` becomes `ANKHEG`.

### `@tra` Tag

Set the translation file for WeiDU:

```typescript
/** @tra smarter_mages.tra */
```

Must be in a JSDoc comment (`/** ... */`).

## Imports

Engine builtins (triggers, actions, objects, constants) come from [IETS](https://github.com/BGforgeNet/iets):

```typescript
import { LOCALS, obj, tra } from "@bgforge/iets";
import { Attack, Global, Myself, Player1, See, SetGlobal } from "@bgforge/iets/bg2";
```

Local `.ts` and `.tbaf` files can also be imported:

```typescript
import { myHelper } from "./helpers";
import { sharedArray } from "./data.tbaf";
```

## Scope Constants

`GLOBAL`, `LOCALS`, and `MYAREA` are auto-quoted in the output:

```typescript
if (See(Player1)) {
  SetGlobal("hostile", LOCALS, 1);
}
// -> SetGlobal("hostile", "LOCALS", 1)
```

Don't wrap them in quotes yourself -- they are quoted automatically.

## Forbidden Syntax

Each of these is an error naming the construct wherever its value or effect would reach the output; a constant nothing reads is never evaluated, so it cannot fail.

| Syntax                                                                | Reason                                                     |
| --------------------------------------------------------------------- | ---------------------------------------------------------- |
| An action outside any `if` or `switch`                                | Its block would match on every pass                        |
| `let`, `var`, assignment, `++`                                        | A compile-time value cannot change (a loop counter can)    |
| A fraction, an inexact `/`, past 32 bits                              | BAF reads 32-bit integers; use `Math.trunc`/`Math.floor`   |
| `default` in `switch`, case fall-through                              | BAF cannot express "none of the above"; end cases in break |
| `while`, `do`, `try`/`catch`                                          | No runtime loops or error handling in BAF                  |
| Arrow functions, classes, `async`/`await`                             | No runtime constructs in BAF                               |
| A condition that is neither a trigger call nor a compile-time boolean | `if (flag)` on an engine name tests nothing                |

## Gotchas and Pitfalls

1. **All evaluation is compile-time.** Variables do not exist at runtime. `const x = 5; if (x > 3)` is evaluated by the transpiler, not the engine. The `if` either always produces a block or never does.

2. **Loop iteration limit.** The maximum is 1000 iterations. BAF scripts should not need many iterations -- if you hit this limit, the script likely has a design issue.

3. **Scope constants are auto-quoted.** `GLOBAL`, `LOCALS`, `MYAREA` become `"GLOBAL"`, `"LOCALS"`, `"MYAREA"` in the output. Don't quote them yourself.

4. **The first matching block runs.** The engine stops at the first block whose conditions hold, unless its response ends in `Continue()`. Order the blocks from the most specific to the least.

5. **Switch expression must be a function call.** `switch (Global("x", "LOCALS"))` works. `switch (someVariable)` does not -- BAF conditions are function calls, not comparisons.

6. **Names follow TypeScript's scopes.** A loop variable exists inside the loop body only, and a constant inside the function or block that declares it.

7. **RESPONSE #100.** All emitted blocks use `RESPONSE #100` (100% probability). Weighted responses are not supported. Use conditions to select between alternatives.

## Compilation

```
.tbaf -> transpiler -> .baf -> WeiDU -> game
```

Press Ctrl+R in VSCode or use the transpile CLI (`fgtp`) to compile.

The CLI type-checks each script first, against the `tsconfig.json` that includes it, and does not transpile one with
type errors - a misspelled engine name, say. `--no-typecheck` skips the check.
