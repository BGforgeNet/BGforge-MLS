import type { DialogModel } from "../../../../../shared/dialog-model";

// Representative model exercising the render: a hub with a back-edge (cycle), a
// conditional choice, an exit terminal, a weighted state, and an unresolved
// %var% external anchor. The adapter that produces such a model from a real D
// parse is covered by server/test/dialog-model.test.ts.
export const SAMPLE: DialogModel = {
    format: "weidu-d",
    editable: true,
    roots: [
        {
            id: "dialog",
            label: "ajantis",
            kind: "dialog",
            states: [
                {
                    id: "hello",
                    speaker: "AJANTIS",
                    text: "Well met, friend.",
                    choices: [
                        { id: "hello#0", text: "Tell me more.", target: { kind: "state", stateId: "more" } },
                        { id: "hello#1", text: "Goodbye.", condition: "Reputation<5", target: { kind: "exit" } },
                    ],
                },
                {
                    id: "more",
                    speaker: "AJANTIS",
                    text: "My tale is long, friend...",
                    weight: 3,
                    choices: [
                        { id: "more#0", text: "anything else?", target: { kind: "state", stateId: "hello" } },
                        { id: "more#1", target: { kind: "external", label: "%AJ_POST%:0", resolved: false } },
                    ],
                },
            ],
        },
    ],
};
