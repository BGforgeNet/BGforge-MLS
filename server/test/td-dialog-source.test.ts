import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseTDSource } from "../src/td/dialog-source";

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
});

describe("parseTDSource - wm_rhia (multisay + entry trigger)", () => {
    const src = sample("wm_rhia.td");

    it("keeps the full multisay and reads the enclosing-if entry trigger", () => {
        const s = parseTDSource(src).states.find((st) => st.label === "state100")!;
        expect(s.sayTexts?.map((t) => t.text)).toEqual(["@100", "@101", "@102", "@103"]);
        expect(s.trigger).toContain("wm_start");
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
