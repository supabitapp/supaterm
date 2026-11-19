/**
 * Browser tests run without the app stylesheet, so a diagram's flex container would measure 0 px.
 * Diagram mounts get a desktop width; a `hidden` subtree still lays out at 0 px.
 */
export function stubDiagramGeometry() {
  const style = document.createElement("style");
  style.textContent = ".chat-markdown-mermaid span { display: block; width: 640px; }";
  document.head.append(style);
  return { [Symbol.dispose]: () => style.remove() };
}
