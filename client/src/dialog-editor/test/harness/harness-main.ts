import { mount } from "svelte";
import DialogGraph from "../../webview/DialogGraph.svelte";
import { REAL_MODEL } from "./real-model";

const target = document.getElementById("app");
if (target) {
    mount(DialogGraph, { target, props: { model: REAL_MODEL } });
}
