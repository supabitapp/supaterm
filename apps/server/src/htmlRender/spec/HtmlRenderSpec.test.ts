import { describe, expect, it } from "@effect/vitest";
import * as Result from "effect/Result";

import { compileHtmlRenderSpec } from "./compileHtmlRenderSpec.ts";
import { parseHtmlRenderSpec } from "./HtmlRenderSpec.ts";

const text = (value: string) => ({ type: "Text", props: { text: value } });
const stack = (...children: Array<string>) => ({ type: "Stack", props: {}, children });
const points = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ label: `P${index}`, value: index }));

const issuesOf = (input: unknown) => {
  const parsed = parseHtmlRenderSpec(input);
  return Result.isFailure(parsed) ? parsed.failure : [];
};

const compiled = (input: unknown) => {
  const parsed = parseHtmlRenderSpec(input);
  if (Result.isFailure(parsed)) throw new Error(parsed.failure.join("\n"));
  return compileHtmlRenderSpec(parsed.success);
};

describe("parseHtmlRenderSpec", () => {
  it("accepts every component in one page", () => {
    const html = compiled({
      root: "page",
      elements: {
        page: { type: "Stack", props: { gap: "lg" }, children: ["title", "row", "trend", "table"] },
        title: { type: "Text", props: { text: "Revenue", variant: "heading" } },
        row: { type: "Columns", props: {}, children: ["bars", "shot"] },
        bars: { type: "BarChart", props: { data: [{ label: "EMEA", value: -6.3 }] } },
        shot: { type: "Image", props: { src: "https://example.com/a.png", alt: "Shot" } },
        trend: { type: "LineChart", props: { data: points(3), yLabel: "Users" } },
        table: { type: "Table", props: { headers: ["Region", "Q3"], rows: [["EMEA", 1240.5]] } },
      },
    });
    expect(html).toContain("<h2>Revenue</h2>");
    expect(html).toContain("1,240.5");
  });

  it.each([
    [
      "an unknown prop instead of dropping it",
      { root: "a", elements: { a: { type: "Text", props: { text: "x", color: "red" } } } },
      "elements.a.props.color: Expected no excess property",
    ],
    [
      "an unknown element field",
      { root: "a", elements: { a: { ...text("x"), style: {} } } },
      "elements.a.style: Expected no excess property",
    ],
    [
      "props of another component",
      { root: "a", elements: { a: { type: "Text", props: { data: [] } } } },
      "elements.a.props.text: Missing key",
    ],
    [
      "children on a leaf",
      { root: "a", elements: { a: { ...text("x"), children: [] } } },
      "elements.a.children: Expected no excess property",
    ],
    [
      "a missing root",
      { root: "b", elements: { a: text("x") } },
      'root: no element has the id "b".',
    ],
    [
      "a missing child",
      { root: "a", elements: { a: stack("b") } },
      'elements.a.children[0]: no element has the id "b".',
    ],
    [
      "the root as a child",
      { root: "a", elements: { a: stack("b"), b: stack("a") } },
      'elements.b.children[0]: "a" is the root.',
    ],
    [
      "a child with two parents",
      { root: "a", elements: { a: stack("b", "c"), b: stack("c"), c: text("x") } },
      'elements.b.children[0]: "c" is already a child of "a".',
    ],
    [
      "a child listed twice",
      { root: "a", elements: { a: stack("b", "b"), b: text("x") } },
      'elements.a.children[1]: "b" is already a child of "a".',
    ],
    [
      "a cycle away from the root",
      { root: "a", elements: { a: text("x"), b: stack("c"), c: stack("b") } },
      "elements.b: not reachable from root.",
    ],
    [
      "an orphan",
      { root: "a", elements: { a: text("x"), b: text("y") } },
      "elements.b: not reachable from root.",
    ],
    [
      "nesting past the depth limit",
      {
        root: "e0",
        elements: Object.fromEntries(
          Array.from({ length: 17 }, (_, index) => [
            `e${index}`,
            index === 16 ? text("x") : stack(`e${index + 1}`),
          ]),
        ),
      },
      "elements.e16: nested deeper than 16 levels.",
    ],
    [
      "a ragged table",
      {
        root: "a",
        elements: { a: { type: "Table", props: { headers: ["A", "B"], rows: [["x"]] } } },
      },
      "elements.a.props.rows[0]: has 1 cells; each row needs one per header (2).",
    ],
    [
      "a relative image path",
      { root: "a", elements: { a: { type: "Image", props: { src: "./a.png", alt: "A" } } } },
      "elements.a.props.src: use an absolute local image path without quotes, or an https URL.",
    ],
    [
      "an infinite chart value",
      {
        root: "a",
        elements: { a: { type: "BarChart", props: { data: [{ label: "A", value: 1e300 }] } } },
      },
      "elements.a.props.data[0].value: Expected a value between -1000000000000000 and 1000000000000000",
    ],
    [
      "a line with one point",
      { root: "a", elements: { a: { type: "LineChart", props: { data: points(1) } } } },
      "elements.a.props.data: Expected a value with a length of at least 2",
    ],
    [
      "a long label",
      {
        root: "a",
        elements: {
          a: { type: "BarChart", props: { data: [{ label: "x".repeat(201), value: 1 }] } },
        },
      },
      "elements.a.props.data[0].label: Expected at most 200 characters",
    ],
    [
      "more chart points than a page allows",
      {
        root: "a",
        elements: {
          a: stack("b", "c", "d"),
          ...Object.fromEntries(
            ["b", "c", "d"].map((id) => [id, { type: "LineChart", props: { data: points(400) } }]),
          ),
        },
      },
      "elements: charts have 1200 points; the limit is 1000.",
    ],
    [
      "more table cells than a page allows",
      {
        root: "a",
        elements: {
          a: {
            type: "Table",
            props: { headers: Array(10).fill("H"), rows: Array(200).fill(Array(10).fill(1)) },
          },
        },
      },
      "elements: tables have 2010 cells; the limit is 2000.",
    ],
    [
      "more elements than a page allows",
      {
        root: "e0",
        elements: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`e${i}`, text("x")])),
      },
      "elements: has 129 elements; the limit is 128.",
    ],
    [
      "an oversized spec before decoding it",
      { root: "a", elements: { a: text("x".repeat(140_000)) } },
      "spec: is 140065 characters of JSON; the limit is 131072.",
    ],
  ])("rejects %s", (_name, input, issue) => {
    expect(issuesOf(input)).toContain(issue);
  });

  it("reports a bounded number of issues", () => {
    const elements = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`e${index}`, text("x")]),
    );
    const issues = issuesOf({ root: "e0", elements });
    expect(issues).toHaveLength(13);
    expect(issues.at(-1)).toBe("…and 7 more.");
  });
});

describe("compileHtmlRenderSpec", () => {
  it("escapes text and attributes", () => {
    const html = compiled({
      root: "a",
      elements: {
        a: stack("b", "c"),
        b: text(`<script>alert("x")</script>`),
        c: { type: "Image", props: { src: "https://example.com/a.png?x=1&y=2", alt: `"><b>` } },
      },
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain('src="https://example.com/a.png?x=1&amp;y=2" alt="&quot;&gt;&lt;b&gt;"');
  });

  it("draws bars from a zero baseline across negative values", () => {
    const html = compiled({
      root: "a",
      elements: {
        a: {
          type: "BarChart",
          props: {
            data: [
              { label: "Up", value: 3 },
              { label: "Down", value: -1 },
            ],
          },
        },
      },
    });
    expect(html).toContain('<div class="bars" style="--zero:25%">');
    expect(html).toContain('style="left:25%;width:75%"');
    expect(html).toContain('style="left:0%;width:25%"');
  });

  it.each([
    ["a flat line", [5, 5]],
    ["values a float step apart", [1e12, 1e12 + 1]],
  ])("scales %s", (_name, values) => {
    const data = values.map((value, index) => ({ label: `P${index}`, value }));
    const html = compiled({ root: "a", elements: { a: { type: "LineChart", props: { data } } } });
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("scales a flat line and labels evenly spaced points", () => {
    const html = compiled({
      root: "a",
      elements: {
        a: {
          type: "LineChart",
          props: { data: Array.from({ length: 12 }, (_, i) => ({ label: `M${i}`, value: 5 })) },
        },
      },
    });
    expect(html).not.toContain("NaN");
    expect(html).toContain('d="M0 100L90.909 100');
    expect(
      [...html.matchAll(/<span(?: class="\w+")? style="left:[\d.]+%">(M\d+)</g)].map(
        (match) => match[1],
      ),
    ).toEqual(["M0", "M3", "M6", "M9"]);
  });
});
