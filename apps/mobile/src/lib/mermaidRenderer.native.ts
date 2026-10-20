import { createDiagramRenderer } from "@supaterm/client-runtime/diagram-rendering";
import renderMermaidWorklet from "@supaterm/mobile-mermaid-worklet";
import {
  createWorkletRuntime,
  runOnRuntimeAsync,
  type WorkletRuntime,
} from "react-native-worklets";

let runtime: WorkletRuntime | undefined;

const renderer = createDiagramRenderer(async (source, options) => {
  runtime ??= createWorkletRuntime({
    name: "mermaid",
    enableEventLoop: false,
    enableNetworking: false,
  });
  return runOnRuntimeAsync(runtime, renderMermaidWorklet, source, options);
});

export const renderMermaidDiagram = renderer.render;
