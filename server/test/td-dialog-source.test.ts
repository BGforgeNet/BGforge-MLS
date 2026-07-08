import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTDSource } from "../src/td/dialog-source";
import { modelFromD } from "../../shared/dialog-model";

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
