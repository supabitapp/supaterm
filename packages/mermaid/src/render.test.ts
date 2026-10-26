import { describe, expect, it } from "vite-plus/test";
import fixtures from "./fixtures.json" with { type: "json" };
import { renderDiagram } from "./render.ts";
import { DIAGRAM_LIMITS, diagramInstanceSvg, isDiagram } from "./diagram.ts";

describe("Pele diagrams", () => {
  it.each(fixtures)("renders $id at a phone width", ({ source }) => {
    const result = renderDiagram(source, { maxWidth: 320, now: 0 });
    expect(isDiagram(result)).toBe(true);
  });

  it("lays out a wide flow vertically without shrinking its labels", () => {
    const source =
      "flowchart LR\nA[Open project] --> B[Start agent] --> C[Review changes] --> D[Run checks] --> E[Commit] --> F[Publish]";
    const narrow = renderDiagram(source, { maxWidth: 320 })!;
    const wide = renderDiagram(source, { maxWidth: 1280 })!;
    expect(narrow.height).toBeGreaterThan(wide.height);
    expect(narrow.width).toBeLessThanOrEqual(320);
    expect(narrow.svg).toContain("font:16px");
  });

  it("keeps a wide flow in the author's direction when asked to", () => {
    const source =
      "flowchart LR\nA[Open project] --> B[Start agent] --> C[Review changes] --> D[Run checks] --> E[Commit] --> F[Publish]";
    const kept = renderDiagram(source, { maxWidth: 320, autoDirection: false })!;
    expect(kept.width).toBeGreaterThan(kept.height);
  });

  it("shows math labels as their TeX source unless a resolver typesets them", () => {
    const source = 'flowchart LR\nA["$$\\nabla \\cdot E$$"] --> B["$$\\neq 0$$"]';
    const literal = renderDiagram(source)!;
    expect(literal.svg).toContain("$$\\nabla \\cdot E$$");
    expect(literal.svg).toContain("$$\\neq 0$$");

    const asked: string[] = [];
    const typeset = renderDiagram(source, {}, (tex) => {
      asked.push(tex);
      return { svg: `<g data-tex="${tex.length}"></g>`, width: 40, height: 12 };
    })!;
    expect(asked).toEqual(["\\nabla \\cdot E", "\\neq 0"]);
    expect(typeset.svg).toContain('data-tex="14"');
    expect(typeset.svg).not.toContain("$$");
  });

  it("preserves author styling and isolates accessibility ids per presentation", () => {
    const result = renderDiagram(
      "flowchart LR\naccTitle: Build\naccDescr: supaterm-diagram-description\nA[supaterm-diagram-label] --> B\nstyle A fill:#123456,color:#abcdef",
    )!;
    expect(result.svg).toContain("#123456");
    expect(result.svg).toContain("#abcdef");
    expect(diagramInstanceSvg(result, "inline")).toContain('aria-labelledby="inline-title"');
    const expanded = diagramInstanceSvg(result, "expanded");
    expect(expanded).toContain('id="expanded-title"');
    expect(expanded).toContain('aria-describedby="expanded-desc"');
    expect(expanded).toContain("supaterm-diagram-description");
    expect(expanded).toContain("supaterm-diagram-label");
  });

  it("gives each presentation its own paint servers", () => {
    const result = renderDiagram("sankey-beta\nRequests,Allowed,80\nAllowed,Cached,30")!;
    const resources = (svg: string) => ({
      ids: [...svg.matchAll(/<linearGradient id="([^"]+)"/g)].map((match) => match[1]),
      references: [...svg.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]),
    });
    const inline = resources(diagramInstanceSvg(result, "inline"));
    const expanded = resources(diagramInstanceSvg(result, "expanded"));
    expect(inline.ids).toHaveLength(2);
    expect(new Set(inline.references)).toEqual(new Set(inline.ids));
    expect(new Set(expanded.references)).toEqual(new Set(expanded.ids));
    expect(inline.ids.filter((id) => expanded.ids.includes(id))).toEqual([]);
  });

  it("never emits active links or remote images", () => {
    const result = renderDiagram(
      'flowchart LR\nA["<img src=x onerror=alert(1)>"] --> B\nclick A "https://example.com"',
    );
    expect(result?.svg ?? "").not.toMatch(/<a\s|<image\s|<script\s|<foreignObject\s|\sonerror=/i);
  });

  it("rejects invalid and oversized input while keeping later renders usable", () => {
    for (const source of [
      "not a diagram",
      "x".repeat(DIAGRAM_LIMITS.sourceChars + 1),
      "flowchart LR\n" + "\n".repeat(512),
      "flowchart LR\n" + "A-->B\n".repeat(257),
    ]) {
      expect(renderDiagram(source)).toBeNull();
    }
    expect(renderDiagram("flowchart LR\nA-->B")).not.toBeNull();
  });
});
