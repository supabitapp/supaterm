import { describe, expect, it, vi } from "vite-plus/test";
import { parse } from "react-native-svg";

vi.mock("react-native-svg", () => vi.importActual("react-native-svg/src/xml"));
import fixtures from "../../../../packages/mermaid/src/fixtures.json";
import { renderDiagram } from "@supaterm/mermaid";
import { nativeDiagramStyles } from "./mermaidSvg";

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  processColor: (color: string) =>
    /^#[\da-f]{6}$/i.test(color) ? Number.parseInt(`ff${color.slice(1)}`, 16) : null,
}));
vi.mock("react-native-svg/src/xmlTags", () => ({
  tags: Object.fromEntries(
    [
      "svg",
      "g",
      "text",
      "tspan",
      "path",
      "rect",
      "circle",
      "ellipse",
      "polygon",
      "polyline",
      "line",
      "title",
      "desc",
    ].map((tag) => [tag, tag]),
  ),
}));

const palette = {
  "--pele-bg": "#101820",
  "--pele-fg": "#eeeeee",
  "--pele-surface": "#223344",
  "--pele-surface-alt": "#304050",
  "--pele-border": "#667788",
};

describe("native diagram styles", () => {
  it.each([
    ["R&D", "R&D"],
    ["x < y > z", "x < y > z"],
    ["&quot;quoted&quot; &apos;value&apos;", "\"quoted\" 'value'"],
    ["&amp;lt; &amp;amp;", "&lt; &amp;"],
    ["`**R&D**`", "R&D"],
  ])("preserves native label text for %s", (label, expected) => {
    const result = renderDiagram(`flowchart TD\nA["${label}"]`)!;
    let nativeText = "";
    parse(result.svg, (root) => {
      nativeDiagramStyles(root, palette);
      const text = (node: typeof root): string =>
        node.children.map((child) => (typeof child === "string" ? child : text(child))).join("");
      nativeText = text(root);
      return root;
    });
    expect(nativeText).toBe(expected);
  });

  it.each(fixtures)("resolves the SVG emitted for $id", ({ source }) => {
    const result = renderDiagram(source, { maxWidth: 320, now: 0 })!;
    let normalized = "";
    const ast = parse(result.svg, (root) => {
      nativeDiagramStyles(root, palette);
      const collect = (node: typeof root): unknown => ({
        props: node.props,
        children: node.children.map((child) =>
          typeof child === "string" ? child : collect(child),
        ),
      });
      normalized = JSON.stringify(collect(root));
      return root;
    });
    expect(ast).not.toBeNull();
    expect(normalized).not.toContain("var(");
    expect(normalized).not.toContain("color-mix(");
    expect(normalized).not.toContain("currentColor");
  });

  it("draws sankey gradients and sub/superscript labels with values native SVG accepts", () => {
    const props: Array<Record<string, unknown>> = [];
    for (const source of [
      "sankey-beta\nRequests,Allowed,80\nAllowed,Cached,30",
      'flowchart LR\nA["H<sub>2</sub>O x<sup>2</sup>"]',
    ]) {
      parse(renderDiagram(source)!.svg, (root) => {
        nativeDiagramStyles(root, palette);
        const collect = (node: typeof root) => {
          props.push(node.props);
          for (const child of node.children) if (typeof child !== "string") collect(child);
        };
        collect(root);
        return root;
      });
    }
    const gradientFills = props.flatMap(({ fill }) =>
      typeof fill === "string" && fill.startsWith("url(") ? [fill] : [],
    );
    expect(gradientFills).toHaveLength(2);
    for (const fill of gradientFills) expect(fill).toMatch(/^url\(#[\w-]+\)$/);
    expect(
      props.flatMap(({ baselineShift, fontSize }) => (baselineShift ? [fontSize] : [])),
    ).toEqual(["0.83em", "0.83em"]);
  });

  it("applies inherited theme aliases, group tints and author overrides to native props", () => {
    let props: unknown;
    parse(
      '<svg style="--_fg:var(--pele-fg,#000);--_r:var(--pele-radius,4px);color:var(--_fg);font:16px sans-serif"><g fill="color-mix(in srgb,var(--pele-surface-alt) 50%,var(--pele-bg))"><rect width="30" height="20" fill="currentColor" style="rx:var(--_r);fill:#abcdef"/></g></svg>',
      (root) => {
        nativeDiagramStyles(root, palette);
        const group = root.children[0];
        if (typeof group === "string" || !group) throw new Error("Missing group");
        const rect = group.children[0];
        if (typeof rect === "string" || !rect) throw new Error("Missing rect");
        props = { root: root.props, group: group.props, rect: rect.props };
        return root;
      },
    );
    expect(props).toEqual({
      root: { color: "#eeeeee", font: "16px sans-serif" },
      group: { fill: "rgba(32,44,56,1)" },
      rect: { width: "30", height: "20", fill: "#abcdef", rx: "4px" },
    });
  });

  it("rejects unresolved author variables so the caller can show source", () => {
    expect(() =>
      parse('<svg><rect fill="var(--unknown)" /></svg>', (root) =>
        nativeDiagramStyles(root, palette),
      ),
    ).toThrow();
  });
});
