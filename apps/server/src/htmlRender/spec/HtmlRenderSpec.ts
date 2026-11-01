import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

import { IMAGE_EXTENSIONS } from "../imageMimeTypes.ts";

export const HTML_RENDER_SPEC_LIMITS = {
  jsonLength: 128 * 1024,
  elements: 128,
  depth: 16,
  tableCells: 2_000,
  chartPoints: 1_000,
};
const MAX_REPORTED_ISSUES = 12;
const MAX_ISSUE_LENGTH = 240;

// Unadvertised: JSON Schema counts code points, so `isMaxLength` would make the element union an `anyOf`.
const isMaxChars = (limit: number) =>
  Schema.makeFilter<string>(
    (text) => text.length <= limit || `Expected at most ${limit} characters`,
    { toJsonSchema: () => ({}) },
  );
const Label = Schema.String.check(isMaxChars(200));
const Gap = Schema.optional(Schema.Literals(["sm", "md", "lg"]));
const ChartValue = Schema.Finite.check(Schema.isBetween({ minimum: -1e15, maximum: 1e15 }));
const Point = Schema.Struct({ label: Label, value: ChartValue });

const Stack = Schema.Struct({
  type: Schema.Literal("Stack"),
  props: Schema.Struct({ gap: Gap }),
  children: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
}).annotate({ description: "Children top to bottom." });

const Columns = Schema.Struct({
  type: Schema.Literal("Columns"),
  props: Schema.Struct({ gap: Gap }),
  children: Schema.Array(Schema.String).check(Schema.isMinLength(2), Schema.isMaxLength(3)),
}).annotate({ description: "One equal column per child; stacks on phones." });

const Text = Schema.Struct({
  type: Schema.Literal("Text"),
  props: Schema.Struct({
    text: Schema.String.check(Schema.isMinLength(1), isMaxChars(4_000)),
    variant: Schema.optional(Schema.Literals(["heading", "body", "caption"])),
  }),
}).annotate({ description: "Plain text; newlines break lines. Default variant body." });

const Table = Schema.Struct({
  type: Schema.Literal("Table"),
  props: Schema.Struct({
    headers: Schema.Array(Label).check(Schema.isMinLength(1), Schema.isMaxLength(12)),
    rows: Schema.Array(
      Schema.Array(Schema.Union([Schema.String.check(isMaxChars(500)), Schema.Finite])),
    ).check(Schema.isMaxLength(500)),
    caption: Schema.optional(Label),
  }),
}).annotate({ description: "Each row has one cell per header." });

const BarChart = Schema.Struct({
  type: Schema.Literal("BarChart"),
  props: Schema.Struct({
    data: Schema.Array(Point).check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    valueLabel: Schema.optional(Label),
  }),
}).annotate({ description: "One horizontal bar per point, from zero." });

const LineChart = Schema.Struct({
  type: Schema.Literal("LineChart"),
  props: Schema.Struct({
    data: Schema.Array(Point).check(Schema.isMinLength(2), Schema.isMaxLength(500)),
    xLabel: Schema.optional(Label),
    yLabel: Schema.optional(Label),
  }),
}).annotate({ description: "One series; points are evenly spaced in order." });

const Image = Schema.Struct({
  type: Schema.Literal("Image"),
  props: Schema.Struct({
    src: Schema.String.check(isMaxChars(2_048)),
    alt: Label,
    caption: Schema.optional(Label),
  }),
}).annotate({ description: "src is an absolute local image path or an https URL." });

// `oneOf` keeps each type's props apart in the advertised schema, which merges `anyOf` unions.
const Element = Schema.Union([Stack, Columns, Text, Table, BarChart, LineChart, Image], {
  mode: "oneOf",
});

export const HtmlRenderSpec = Schema.Struct({
  root: Schema.String,
  elements: Schema.Record(Schema.String, Element),
}).annotate({
  description:
    "A page as data, which Supaterm renders with the theme. elements maps ids to components and root names the top one. Each other element is the child of exactly one Stack or Columns.",
});
export type HtmlRenderSpec = typeof HtmlRenderSpec.Type;
export type HtmlRenderSpecElement = typeof Element.Type;

const decodeStrict = Schema.decodeUnknownResult(HtmlRenderSpec);
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1();

const LOCAL_IMAGE_PATH = new RegExp(
  String.raw`^(?:/(?!/)|[a-z]:[\\/])[^\r\n]*\.(?:${IMAGE_EXTENSIONS})$`,
  "i",
);

const formatPath = (path: ReadonlyArray<PropertyKey>) =>
  path
    .map((key, index) =>
      typeof key === "number" ? `[${key}]` : index === 0 ? String(key) : `.${String(key)}`,
    )
    .join("");

const contentIssues = (id: string, element: HtmlRenderSpecElement): ReadonlyArray<string> => {
  const at = `elements.${id}.props`;
  switch (element.type) {
    case "Table":
      return element.props.rows.flatMap((row, index) =>
        row.length === element.props.headers.length
          ? []
          : [
              `${at}.rows[${index}]: has ${row.length} cells; each row needs one per header (${element.props.headers.length}).`,
            ],
      );
    case "Image":
      return LOCAL_IMAGE_PATH.test(element.props.src) ||
        /^https:\/\/[^\s]+$/i.test(element.props.src)
        ? []
        : [`${at}.src: use an absolute local image path or an https URL.`];
    default:
      return [];
  }
};

const graphIssues = (spec: HtmlRenderSpec): ReadonlyArray<string> => {
  const { elements, root } = spec;
  const ids = Object.keys(elements);
  if (ids.length > HTML_RENDER_SPEC_LIMITS.elements) {
    return [
      `elements: has ${ids.length} elements; the limit is ${HTML_RENDER_SPEC_LIMITS.elements}.`,
    ];
  }
  if (!Object.hasOwn(elements, root)) return [`root: no element has the id "${root}".`];
  const issues: Array<string> = [];
  const parents = new Map<string, string>();
  for (const id of ids) {
    const element = elements[id]!;
    issues.push(...contentIssues(id, element));
    if (!("children" in element)) continue;
    element.children.forEach((child, index) => {
      const at = `elements.${id}.children[${index}]`;
      if (!Object.hasOwn(elements, child)) issues.push(`${at}: no element has the id "${child}".`);
      else if (child === root) issues.push(`${at}: "${child}" is the root.`);
      else if (parents.has(child))
        issues.push(`${at}: "${child}" is already a child of "${parents.get(child)}".`);
      else parents.set(child, id);
    });
  }
  let tableCells = 0;
  let chartPoints = 0;
  const reached = new Set([root]);
  let level = [root];
  for (let depth = 1; level.length > 0; depth += 1) {
    if (depth > HTML_RENDER_SPEC_LIMITS.depth) {
      return [
        ...issues,
        `elements.${level[0]}: nested deeper than ${HTML_RENDER_SPEC_LIMITS.depth} levels.`,
      ];
    }
    const next: Array<string> = [];
    for (const id of level) {
      const element = elements[id]!;
      if (element.type === "Table")
        tableCells += element.props.headers.length * (element.props.rows.length + 1);
      if (element.type === "BarChart" || element.type === "LineChart")
        chartPoints += element.props.data.length;
      if (!("children" in element)) continue;
      for (const child of element.children) {
        if (parents.get(child) !== id || reached.has(child)) continue;
        reached.add(child);
        next.push(child);
      }
    }
    level = next;
  }
  for (const id of ids) {
    if (!reached.has(id)) issues.push(`elements.${id}: not reachable from root.`);
  }
  if (tableCells > HTML_RENDER_SPEC_LIMITS.tableCells)
    issues.push(
      `elements: tables have ${tableCells} cells; the limit is ${HTML_RENDER_SPEC_LIMITS.tableCells}.`,
    );
  if (chartPoints > HTML_RENDER_SPEC_LIMITS.chartPoints)
    issues.push(
      `elements: charts have ${chartPoints} points; the limit is ${HTML_RENDER_SPEC_LIMITS.chartPoints}.`,
    );
  return issues;
};

const bounded = (issues: ReadonlyArray<string>) => {
  const shown = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) =>
      issue.length > MAX_ISSUE_LENGTH ? `${issue.slice(0, MAX_ISSUE_LENGTH - 1)}…` : issue,
    );
  return issues.length > shown.length
    ? [...shown, `…and ${issues.length - shown.length} more.`]
    : shown;
};

/** Strict: unknown fields fail instead of being dropped, so the published page is the one asked for. */
export const parseHtmlRenderSpec = (
  input: unknown,
): Result.Result<HtmlRenderSpec, ReadonlyArray<string>> => {
  const length = JSON.stringify(input)?.length ?? 0;
  if (length > HTML_RENDER_SPEC_LIMITS.jsonLength) {
    return Result.fail([
      `spec: is ${length} characters of JSON; the limit is ${HTML_RENDER_SPEC_LIMITS.jsonLength}.`,
    ]);
  }
  const decoded = decodeStrict(input, { onExcessProperty: "error", errors: "all" });
  if (Result.isFailure(decoded)) {
    return Result.fail(
      bounded(
        formatIssue(decoded.failure.issue).issues.map(({ path, message }) =>
          path === undefined || path.length === 0
            ? `spec: ${message}`
            : `${formatPath(path.map((segment) => (typeof segment === "object" ? segment.key : segment)))}: ${message}`,
        ),
      ),
    );
  }
  const issues = graphIssues(decoded.success);
  return issues.length === 0 ? Result.succeed(decoded.success) : Result.fail(bounded(issues));
};
