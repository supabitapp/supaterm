export function getDiffHeaderClickAction(event: MouseEvent) {
  const path = event.composedPath();
  for (const node of path) {
    if (node instanceof HTMLButtonElement || node instanceof HTMLAnchorElement) return null;
  }
  const header = path.find(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.hasAttribute("data-diffs-header"),
  );
  const root = header?.getRootNode();
  const fileKey =
    root instanceof ShadowRoot
      ? root.host.querySelector("[data-diff-file-key]")?.getAttribute("data-diff-file-key")
      : null;
  return fileKey ? { type: "toggle" as const, fileKey } : null;
}
