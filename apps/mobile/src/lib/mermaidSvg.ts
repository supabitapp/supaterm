import { processColor } from "react-native";
import type { XmlAST } from "react-native-svg";

const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function channels(color: string) {
  const value = processColor(color.trim());
  if (typeof value !== "number") throw new Error("Unsupported diagram color");
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255, (value >>> 24) / 255];
}

function mixColors(first: string, percent: string, second: string) {
  const a = channels(first);
  const b = channels(second);
  const weight = Number(percent) / 100;
  const alpha = a[3]! * weight + b[3]! * (1 - weight);
  const rgb = a
    .slice(0, 3)
    .map((channel, index) =>
      alpha ? Math.round((channel * a[3]! * weight + b[index]! * b[3]! * (1 - weight)) / alpha) : 0,
    );
  return `rgba(${rgb.join(",")},${alpha})`;
}

export function nativeDiagramStyles(root: XmlAST, palette: Readonly<Record<string, string>>) {
  function visit(node: XmlAST, inherited: Readonly<Record<string, string>>, color: string) {
    const style = node.props.style;
    const props = { ...node.props, ...(typeof style === "object" ? style : {}) };
    const variables: Record<string, string> = { ...inherited };
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith("--") && typeof value === "string") variables[key] = value;
    }
    function resolve(value: string): string {
      let result = value;
      for (let depth = 0; depth < 16 && result.includes("var("); depth++) {
        const next = result.replace(
          /var\((--[\w-]+)(?:,\s*([^()]*))?\)/g,
          (_match, key: string, fallback: string | undefined) => {
            const replacement = variables[key] ?? fallback;
            if (replacement === undefined) throw new Error("Unknown diagram theme variable");
            return replacement;
          },
        );
        if (next === result) throw new Error("Unsupported diagram theme expression");
        result = next;
      }
      if (result.includes("var(")) throw new Error("Recursive diagram theme variable");
      const mix = /^color-mix\(in srgb,\s*(.+) ([\d.]+)%,\s*(.+)\)$/.exec(result);
      if (mix) result = mixColors(mix[1]!, mix[2]!, mix[3]!);
      if (result.includes("color-mix(")) throw new Error("Unsupported diagram color expression");
      return result;
    }
    const ownColor = typeof props.color === "string" ? resolve(props.color) : color;
    node.props = {};
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith("--") || key === "style" || key === "maxWidth" || value === undefined)
        continue;
      if (key === "height" && value === "auto") continue;
      if (typeof value === "number") {
        node.props[key] = String(value);
        continue;
      }
      if (typeof value !== "string") continue;
      const resolved = resolve(value).replace(/\bcurrentColor\b/gi, ownColor);
      // react-native-svg drops a url() paint that carries a fallback colour, and reads font sizes
      // as numbers: iOS draws "smaller" at 0px and Android throws.
      node.props[key] =
        key === "fontSize" && resolved === "smaller"
          ? "0.83em"
          : resolved.replace(/^(url\(#[^)]+\))\s.+$/, "$1");
    }
    node.children = node.children.map((child) => {
      if (typeof child === "string") {
        return child.replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity]!);
      }
      visit(child, variables, ownColor);
      return child;
    });
  }
  visit(root, palette, palette["--pele-fg"] ?? "#1f1f1f");
  return root;
}
