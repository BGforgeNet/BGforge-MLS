/**
 * Type definitions for TBAF (TypeScript to BAF) runtime API.
 * This file is used for TypeScript validation of TBAF samples only.
 */

// --- IElib sync surface start ---
// These types must be structurally compatible with BGforge IElib.
// Both projects define them independently; keep shapes and brand strings identical.
type StrRef = number & { __brand: "StrRef" };
type Point = [number, number];
// --- IElib sync surface end ---

// Translation references
/** @deprecated Use `tra()` from ielib instead. */
declare function $tra(ref: number): StrRef;

// WeiDU script triggers (conditions)
declare function True(): boolean;
declare function False(): boolean;
declare function See(object: any): boolean;
// Global with 3 args is a trigger; with 2 args is a marker for switch statements (transpiler handles specially)
// Note: Using 'var' to ensure Global is treated as a value, not a type (avoids conflict with @types/node)
declare var Global: {
    (varName: string, scope: string): any;
    (varName: string, scope: string, value: number): boolean;
};
declare function InParty(who: any): boolean;
declare function StateCheck(who: any, state: any): boolean;

// WeiDU script actions
declare function Attack(target: any): void;
declare function SetGlobal(varName: string, scope: string, value: number): void;
declare function Continue(): void;
declare function NoAction(): void;
declare function Wait(ticks: number): void;
declare function GiveItemCreate(item: string, target: any, count: number, p1: number, p2: number): void;
declare function CreateCreature(resref: string, location: Point, facing: number): void;
declare function JumpToPoint(location: Point): void;
declare function DisplayString(who: any, strref: number): void;
declare function DisplayStringHead(who: any, strref: number): void;
declare function ActionOverride(who: any, action: any): void;
declare function StartDialogNoSet(who: any): void;
declare function ActionA(): void;
declare function ActionB(): void;
declare function EscapeArea(): void;

// Objects (using 'var' to avoid conflict with td-engine-stubs.d.ts)
declare var Player1: any;
declare var Player2: any;
declare var Myself: any;
declare var STATE_SLEEPING: any;

// Functions that return objects (using 'var' to avoid conflict with td-engine-stubs.d.ts)
declare var NearestEnemyOf: (who: any) => any;
declare var LastTalkedToBy: any;
