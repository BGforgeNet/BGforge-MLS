import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTDSource } from "../src/td/dialog-source";
import { modelFromD } from "../../shared/dialog-model";

// The syntax-error degrade logs through the LSP connection, which unit tests never initialize.
vi.mock("../src/logger", () => ({ conlog: vi.fn() }));

const dir = fileURLToPath(new URL("td/samples", import.meta.url));
const sample = (name: string): string => readFileSync(`${dir}/${name}`, "utf8");

describe("parseTDSource - botsmith (statement-form replies)", () => {
    const src = sample("botsmith.td");

    it("finds the state functions, each with a range into the TD source", () => {
        const data = parseTDSource(src);
        expect(data.states.map((s) => s.label).sort()).toEqual(["g_armor", "g_item_type", "g_trinket", "g_weapon"]);
        const s = data.states.find((st) => st.label === "g_item_type")!;
        expect(src.slice(s.range!.start, s.range!.end)).toContain("function g_item_type");
        expect(s.sayTexts?.map((t) => t.text)).toEqual(["@21"]);
    });

    it("pairs reply()+goTo() statements into transitions", () => {
        const s = parseTDSource(sample("botsmith.td")).states.find((st) => st.label === "g_item_type")!;
        expect(s.transitions.map((t) => t.replyText)).toEqual(["@3", "@4", "@5", "@6"]);
        expect(s.transitions[0]!.target).toEqual({ kind: "goto", label: "g_weapon" });
    });

    it("records each transition's whole reply+goTo statement group span, its target-call span, and the fn name span", () => {
        const s = parseTDSource(src).states.find((st) => st.label === "g_item_type")!;
        const t0 = s.transitions[0]!;
        // range spans the complete player option: `reply(tra(3));\n    goTo(g_weapon);`.
        expect(src.slice(t0.range!.start, t0.range!.end)).toBe("reply(tra(3));\n    goTo(g_weapon);");
        // targetCallRange isolates just the target-producing call, for an exit() flip.
        expect(src.slice(t0.targetCallRange!.start, t0.targetCallRange!.end)).toBe("goTo(g_weapon)");
        // nameRange covers the function's own name token.
        expect(src.slice(s.nameRange!.start, s.nameRange!.end)).toBe("g_item_type");
    });

    it("records state-list wiring (append membership + insertion anchors)", () => {
        const data = parseTDSource(src);
        const wiring = data.tdWiring!;
        // Every append-list element is a state ref, plus the extendBottom entry goTo(g_item_type).
        const listRefs = wiring.refs.filter((r) => r.kind === "list").map((r) => r.name);
        expect(listRefs).toEqual(["g_item_type", "g_weapon", "g_armor", "g_trinket"]);
        const entryRefs = wiring.refs.filter((r) => r.kind === "entry");
        expect(entryRefs.map((r) => r.name)).toEqual(["g_item_type"]);
        expect(src.slice(entryRefs[0]!.callRange!.start, entryRefs[0]!.callRange!.end)).toBe("goTo(g_item_type)");
        // The list insert anchor sits just before the array's closing `]`, joining with ", ".
        expect(src.slice(wiring.listInsert!.offset - "g_trinket".length, wiring.listInsert!.offset)).toBe("g_trinket");
        expect(src[wiring.listInsert!.offset]).toBe("]");
        expect(wiring.listInsert!.separator).toBe(", ");
        // The new-function anchor is the start of the `append(...)` statement.
        expect(src.slice(wiring.newFnAnchor!, wiring.newFnAnchor! + "append".length)).toBe("append");
    });

    it("threads the transition/name spans and wiring onto the DialogModel via modelFromD", () => {
        const model = { ...modelFromD(parseTDSource(src)), sourceLang: "td" as const };
        const state = model.roots.flatMap((r) => r.states).find((s) => s.id === "g_item_type")!;
        expect(src.slice(state.nameRange!.start, state.nameRange!.end)).toBe("g_item_type");
        const c0 = state.choices[0]!;
        expect(src.slice(c0.sourceRange!.start, c0.sourceRange!.end)).toBe("reply(tra(3));\n    goTo(g_weapon);");
        expect(src.slice(c0.targetCallRange!.start, c0.targetCallRange!.end)).toBe("goTo(g_weapon)");
        expect(model.tdWiring!.refs.filter((r) => r.kind === "list")).toHaveLength(4);
    });
});

describe("parseTDSource - wm_rhia (multisay + entry trigger)", () => {
    const src = sample("wm_rhia.td");

    it("keeps the full multisay and reads the enclosing-if entry trigger", () => {
        const s = parseTDSource(src).states.find((st) => st.label === "state100")!;
        expect(s.sayTexts?.map((t) => t.text)).toEqual(["@100", "@101", "@102", "@103"]);
        expect(s.trigger).toContain("wm_start");
    });

    it("records the sole-content enclosing-if span and the ambient forward-decl span for delete cleanup", () => {
        const s = parseTDSource(src).states.find((st) => st.label === "state100")!;
        // The state gate `if (Global(...)) { function state100() {...} }` is recorded whole (starts at `if`).
        expect(src.slice(s.enclosingIfRange!.start, s.enclosingIfRange!.start + 3)).toBe("if ");
        expect(src.slice(s.enclosingIfRange!.start, s.enclosingIfRange!.end)).toContain("function state100()");
        expect(src.slice(s.enclosingIfRange!.start, s.enclosingIfRange!.end).trimEnd().endsWith("}")).toBe(true);
        // The `declare function state100(): void;` forward declaration span is recorded for delete cleanup.
        expect(src.slice(s.forwardDeclStmtRange!.start, s.forwardDeclStmtRange!.end)).toBe(
            "declare function state100(): void;",
        );
    });
});

describe("parseTDSource - g_bags (chain-form replies)", () => {
    const src = sample("g_bags_v2.td");

    it("records a chain-form transition's target span as just its trailing .goTo(t) call", () => {
        const s = parseTDSource(src).states.find((st) => st.label === "state0")!;
        const t0 = s.transitions.find((t) => t.target.kind === "goto" && t.target.label === "state1")!;
        // For `reply(tra(21)).goTo(state1)` the isolable target call is `goTo(state1)` (no leading dot).
        expect(src.slice(t0.targetCallRange!.start, t0.targetCallRange!.end)).toBe("goTo(state1)");
    });
});

describe("parseTDSource - cohort smoke", () => {
    it("parses every real .td sample without throwing, every state ranged", () => {
        for (const f of readdirSync(dir).filter((n) => n.endsWith(".td"))) {
            const data = parseTDSource(sample(f));
            for (const s of data.states) {
                expect(s.range, `${f}::${s.label} missing range`).toBeDefined();
            }
        }
    });
});

describe("parseTDSource - faithfulness gate for constructs the transition-list can't round-trip", () => {
    // The flat transition list models an unconditional `reply -> goTo`. An `else` branch adds transitions with a
    // negated gate, and a transition nested in an inner `if` is condition-gated - neither round-trips through the
    // flat list. The parser marks such a state `faithful: false` so the editor treats it read-only instead of
    // silently dropping the else / the condition on save.
    const stateOf = (src: string, label: string) => parseTDSource(src).states.find((s) => s.label === label)!;

    it("a plain unconditional state is not flagged (faithful stays unset)", () => {
        const src = `function s0() { say(tra(1)); reply(tra(2)).goTo(s1); }\nfunction s1() { say(tra(3)); }\n`;
        expect(stateOf(src, "s0").faithful).toBeUndefined();
    });

    it("marks a state with an `else` branch unfaithful (its else transitions are dropped)", () => {
        const src = `function s0() {
    say(tra(1));
    if (PartyHasItem("SWORD01")) { reply(tra(2)).goTo(hasSword); }
    else { reply(tra(3)).goTo(noSword); }
}
function hasSword() { say(tra(4)); }
function noSword() { say(tra(5)); }
`;
        expect(stateOf(src, "s0").faithful).toBe(false);
    });

    it("marks a state with a transition gated by an inner `if` unfaithful (the condition is dropped)", () => {
        const src = `function s0() {
    say(tra(1));
    if (Global("q", "GLOBAL", 1)) { reply(tra(2)).goTo(s1); }
}
function s1() { say(tra(3)); }
`;
        expect(stateOf(src, "s0").faithful).toBe(false);
    });

    it("conjoins EVERY enclosing `if` into the trigger, not just the nearest (no outer gate dropped)", () => {
        const src = `if (Global("chapter", "GLOBAL", 3)) {
    if (Global("quest", "GLOBAL", 1)) {
        function s100() { say(tra(1)); }
    }
}
`;
        const s = stateOf(src, "s100");
        expect(s.trigger).toContain('Global("quest", "GLOBAL", 1)');
        expect(s.trigger).toContain('Global("chapter", "GLOBAL", 3)');
    });
});

describe("parseTDSource - malformed input", () => {
    it("degrades to the empty model on a syntax error instead of building anchors from a misnested parse", () => {
        // Unclosed brace: TS error recovery swallows the following function into s1's body, so a best-effort
        // parse would re-parent s2 and yield splice anchors the write-back cannot trust.
        const src = `function s1() { say(tra(1));
function s2() { say(tra(2)); }
`;
        expect(parseTDSource(src)).toEqual({ blocks: [], states: [] });
    });

    it("still parses clean input after the guard (the guard stays silent on valid source)", () => {
        const src = `function s1() { say(tra(1)); }
`;
        expect(parseTDSource(src).states.map((s) => s.label)).toEqual(["s1"]);
    });
});
