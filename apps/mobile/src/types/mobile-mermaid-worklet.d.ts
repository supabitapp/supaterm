declare module "@supaterm/mobile-mermaid-worklet" {
  export default function renderMermaidWorklet(
    source: string,
    options: import("@supaterm/mermaid/diagram").DiagramOptions,
  ): import("@supaterm/mermaid/diagram").Diagram | null;
}
