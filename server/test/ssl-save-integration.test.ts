import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL } from "../../shared/dialog-model";
import { applySSLDialogEdits } from "../../shared/dialog-ssl-edit";
import { allocateNodeIds, allocateOptionIds } from "../../shared/dialog-ssl-ids";
import { appendMsgEntries, rewriteMsgEntries } from "../../shared/dialog-tra-edit";

// Exercises the full add-option save composition the panel runs (parse -> allocate ids -> splice .ssl
// -> rewrite+append .msg), end to end through the REAL parser, minus only vscode's WorkspaceEdit write.
describe("SSL add-option save round-trip", () => {
    const SRC = `procedure Node001 begin
    NOption(101, Node002, 4);
end
procedure Node002 begin Reply(200); end
procedure talk_p_proc begin call Node001; end
`;
    const MSG = `{100}{}{npc}\n{101}{}{go}\n{200}{}{two}\n`;

    it("allocates an id, splices a new NOption, appends the .msg, and the result re-parses", async () => {
        const original = modelFromSSL(await parseDialog(SRC));
        const onDiskMessages = { "100": "npc", "101": "go", "200": "two" };

        // Simulate the webview "+ option" gesture: a new option with literal text and no callRange.
        const edited = structuredClone(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.choices.push({
            id: "Node001#new0",
            text: "Brand new option",
            target: { kind: "state", stateId: "Node002" },
        });

        // The panel's save composition:
        const created = allocateOptionIds(edited, onDiskMessages); // mutates the new option's text -> @id
        const allMessages = { ...onDiskMessages, ...created };
        const newSrc = applySSLDialogEdits(SRC, edited, original);
        const newMsg = appendMsgEntries(rewriteMsgEntries(MSG, allMessages), allMessages); // == writeMessages(.msg)

        // Id is max(100,101,200)+1 = 201; the .ssl gets a bare-number NOption, the .msg gets the text.
        expect(created).toEqual({ "201": "Brand new option" });
        expect(newSrc).toContain("NOption(201, Node002);");
        expect(newMsg).toContain("{201}{}{Brand new option}");

        // The written .ssl re-parses and Node001 now has two real options.
        const reparsed = modelFromSSL(await parseDialog(newSrc));
        const opts = reparsed.roots[0]!.states.find((s) => s.id === "Node001")!.choices.filter((c) => c.callRange);
        expect(opts).toHaveLength(2);
        expect(opts.map((o) => (o.target.kind === "state" ? o.target.stateId : ""))).toEqual(["Node002", "Node002"]);
    });
});

// Exercises the full add-NODE save composition the panel runs (parse -> allocate node ids -> allocate
// option ids -> splice .ssl -> rewrite+append .msg), end to end through the REAL parser.
describe("SSL add-node save round-trip", () => {
    it("allocates ids, splices a procedure, appends the .msg, and the result re-parses", async () => {
        const SRC = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin call Node001; end\n`;
        const MSG = `{100}{}{npc}\n{101}{}{go}\n{200}{}{two}\n`;
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredClone(original);
        edited.roots[0]!.states.push({
            id: "Node050",
            text: "New npc line",
            choices: [{ id: "Node050#opt0", text: "New option", target: { kind: "exit" } }],
        });
        edited.roots[0]!.states.find((s) => s.id === "Node001")!.choices[0]!.target = {
            kind: "state",
            stateId: "Node050",
        };

        // The panel save composition: node ids first (reply + options), then option ids for any new
        // options on existing nodes, against the merged set so ids never collide.
        const onDisk = { "100": "npc", "101": "go", "200": "two" };
        const node = allocateNodeIds(edited, onDisk);
        const opt = allocateOptionIds(edited, { ...onDisk, ...node.newMessages });
        const allMessages = { ...onDisk, ...node.newMessages, ...opt };
        const newSrc = applySSLDialogEdits(SRC, edited, original);
        const newMsg = appendMsgEntries(rewriteMsgEntries(MSG, allMessages), allMessages);

        // Ids are max(100,101,200)+1.. = 201 (reply), 202 (option).
        expect(newSrc).toContain("procedure Node050 begin\n    Reply(201);\n    NMessage(202);\nend");
        expect(newMsg).toContain("{201}{}{New npc line}");
        expect(newMsg).toContain("{202}{}{New option}");
        // Node050 survives the re-parse because Node001's option now targets it (reachability keeps it).
        const reparsed = modelFromSSL(await parseDialog(newSrc));
        expect(reparsed.roots[0]!.states.find((s) => s.id === "Node050")).toBeDefined();
    });
});

// Tier 3b node-wiring round-trips through the REAL parser: add an entry node, rename a node, and delete a
// node that is BOTH an entry and call-referenced (exercising the entry-call + inbound-call removal together).
describe("SSL Tier 3b node-wiring save round-trips", () => {
    it("add-entry-node save: new node gets a procedure, a talk_p_proc call, and re-parses as an entry", async () => {
        const SRC = `procedure Node001 begin\n    Reply(100);\nend\nprocedure talk_p_proc begin\n    call Node001;\nend\n`;
        const MSG = `{100}{}{npc}\n`;
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredClone(original);
        edited.roots[0]!.states.push({ id: "Node050", text: "New entry line", isEntry: true, choices: [] });

        const onDisk = { "100": "npc" };
        const node = allocateNodeIds(edited, onDisk);
        const allMessages = { ...onDisk, ...node.newMessages };
        const newSrc = applySSLDialogEdits(SRC, edited, original);
        const newMsg = appendMsgEntries(rewriteMsgEntries(MSG, allMessages), allMessages);

        expect(newSrc).toContain("procedure Node050 begin\n    Reply(101);\nend");
        expect(newMsg).toContain("{101}{}{New entry line}");
        const reparsed = await parseDialog(newSrc);
        expect(reparsed.entryPoints).toContain("Node050"); // wired as a real entry
    });

    it("rename save: re-parses with the new procedure name and references", async () => {
        const SRC = `procedure Node001 begin\n    NOption(101, Node002, 4);\nend\nprocedure Node002 begin\n    call Node001;\nend\nprocedure talk_p_proc begin call Node001; end\n`;
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredClone(original);
        const n1 = edited.roots[0]!.states.find((s) => s.id === "Node001")!;
        n1.renamedFrom = "Node001";
        n1.id = "Node009";
        const out = applySSLDialogEdits(SRC, edited, original);
        const reparsed = await parseDialog(out);
        expect(reparsed.nodes.find((n) => n.name === "Node009")).toBeDefined();
        expect(reparsed.nodes.find((n) => n.name === "Node001")).toBeUndefined();
        expect(reparsed.entryPoints).toContain("Node009"); // entry call renamed too
    });

    it("delete a node that is both an entry and call-referenced: procedure + both calls removed", async () => {
        const SRC = `procedure Node001 begin\n    call Node002;\nend\nprocedure Node002 begin Reply(200); end\nprocedure talk_p_proc begin\n    call Node001;\n    call Node002;\nend\n`;
        const original = modelFromSSL(await parseDialog(SRC));
        const edited = structuredClone(original);
        edited.roots[0]!.states = edited.roots[0]!.states.filter((s) => s.id !== "Node002");
        const out = applySSLDialogEdits(SRC, edited, original);
        expect(out).not.toContain("procedure Node002");
        expect(out).not.toContain("call Node002;"); // both the intra-node call and the talk_p_proc entry call
        const reparsed = await parseDialog(out);
        expect(reparsed.nodes.find((n) => n.name === "Node002")).toBeUndefined();
        expect(reparsed.entryPoints).toContain("Node001"); // the surviving entry is intact
    });
});
