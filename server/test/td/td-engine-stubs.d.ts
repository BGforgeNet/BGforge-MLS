/**
 * Engine-specific stubs for TD test samples.
 * These declarations exist only for typecheck-samples.sh validation.
 * In production, engine functions are generated per-project from server/data/*.yml.
 */

// ---------------------------------------------------------------------------
// Engine trigger functions (return boolean)
// ---------------------------------------------------------------------------

// Using 'var' to avoid conflict with @types/node Global type and tbaf-runtime.d.ts
declare var Global: {
    (varName: string, scope: string): any;
    (varName: string, scope: string, value: number): boolean;
};
declare function NumTimesTalkedTo(count: number): boolean;
declare function InParty(name: string): boolean;
declare function InPartySlot(who: any, slot: number): boolean;
declare function See(name: string): boolean;
declare function StateCheck(who: string, state: any): boolean;
declare function PartyHasItem(item: string): boolean;
declare function PartyGoldGT(gold: number): boolean;
declare function IsValidForPartyDialog(who: any): boolean;
declare function IsValidForPartyDialogue(who: any): boolean;
declare function False(): boolean;
declare function True(): boolean;

// ---------------------------------------------------------------------------
// Engine action functions (return Action)
// ---------------------------------------------------------------------------

declare function SetGlobal(name: string, scope: string, value: number): Action;
declare function SetNumTimesTalkedTo(count: number): Action;
declare function IncrementGlobal(name: string, scope: string, value: number): Action;
declare function Enemy(): Action;
declare function EscapeArea(): Action;
declare function DestroyItem(item: string): Action;
declare function TakePartyItem(item: string): Action;
declare function ForceSpell(target: any, spell: any): Action;
declare function ApplySpellRES(spell: string, target: any): Action;
declare function GiveItemCreate(item: string, target: string, count: number, p1: number, p2: number): Action;
declare function AddexperienceParty(xp: number): Action;

// ---------------------------------------------------------------------------
// Text and object helpers (in production, provided by ielib)
// ---------------------------------------------------------------------------

declare function tra(ref: number): StrRef;
declare function tlk(ref: number): StrRef;

declare class ObjectSpec {
    id: string;
}
declare function obj(spec: string): ObjectSpec;

// ---------------------------------------------------------------------------
// Engine constants
// ---------------------------------------------------------------------------

declare var STATE_SLEEPING: number;
declare var Myself: any;
declare var DRYAD_TELEPORT: any;
declare var LastTalkedToBy: any;

// ---------------------------------------------------------------------------
// WeiDU variable references (used in samples as inline actions/calls)
// ---------------------------------------------------------------------------

declare var action_bg1_bags: Action;
declare function action_drink(): void;
