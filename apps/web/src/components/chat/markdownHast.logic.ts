export function plainHastText(node: unknown) {
  if (!node || typeof node !== "object" || !("children" in node) || !Array.isArray(node.children)) {
    return null;
  }
  const parts = node.children.map((child) => {
    if (
      child &&
      typeof child === "object" &&
      "type" in child &&
      child.type === "text" &&
      "value" in child &&
      typeof child.value === "string"
    ) {
      return child.value;
    }
    return null;
  });
  return parts.every((part) => part !== null) ? parts.join("") : null;
}

export function hastPlainTextDeep(node: unknown): string;
export function hastPlainTextDeep(node: unknown) {
  if (!node || typeof node !== "object") return "" satisfies string;
  if ("type" in node && node.type === "text" && "value" in node && typeof node.value === "string") {
    return node.value satisfies string;
  }
  if (!("children" in node) || !Array.isArray(node.children)) return "" satisfies string;
  return node.children.map(hastPlainTextDeep).join("") satisfies string;
}

export function hastHasText(node: unknown) {
  if (!node || typeof node !== "object") return false;
  if (
    "type" in node &&
    node.type === "text" &&
    "value" in node &&
    typeof node.value === "string" &&
    node.value.trim().length > 0
  ) {
    return true;
  }
  return "children" in node && Array.isArray(node.children) && node.children.some(hastHasText);
}
