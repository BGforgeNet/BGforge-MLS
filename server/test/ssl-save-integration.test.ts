import { describe, expect, it } from "vitest";
import { parseDialog } from "../src/dialog";
import { modelFromSSL } from "../../shared/dialog-model";
import { applySSLDialogEdits } from "../../shared/dialog-ssl-edit";
import { allocateOptionIds } from "../../shared/dialog-ssl-ids";
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
