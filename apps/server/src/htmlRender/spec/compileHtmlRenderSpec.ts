import type { HtmlRenderSpec, HtmlRenderSpecElement } from "./HtmlRenderSpec.ts";

const PLOT_WIDTH = 1_000;
const PLOT_HEIGHT = 200;
const MAX_DOTS = 60;
const MAX_X_TICKS = 6;
const MAX_TICK_LABEL = 18;

const CSS = [
  ".stack{display:flex;flex-direction:column;gap:16px}",
  ".columns{display:grid;grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:16px;align-items:start}",
  ".gap-sm{gap:8px}.gap-lg{gap:24px}",
  "@media (max-width:520px){.columns{grid-template-columns:minmax(0,1fr)}}",
  "h2{margin:0;font-size:18px;font-weight:600;line-height:1.3}",
  "p{margin:0;white-space:pre-line}",
  "figure{margin:0;min-width:0}",
  ".caption,figcaption,.axis{font-size:12px;color:var(--muted-foreground)}",
  "figcaption{margin-top:6px}",
  ".scroll{overflow-x:auto}",
  "table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}",
  "th,td{padding:6px 12px 6px 0;text-align:left;vertical-align:top;border-bottom:1px solid var(--border)}",
  "th:last-child,td:last-child{padding-right:0}",
  "th{font-weight:600;white-space:nowrap}",
  "tbody tr:last-child td{border-bottom:0}",
  ".num{text-align:right}",
  ".bars{display:grid;grid-template-columns:fit-content(40%) minmax(0,1fr) auto;gap:6px 10px;align-items:center}",
  ".bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".bar-track{position:relative;height:14px}",
  ".bar-track::before{content:'';position:absolute;left:var(--zero);top:-4px;bottom:-4px;border-left:1px solid var(--border)}",
  ".bar{position:absolute;top:0;bottom:0;background:var(--chart-1);border-radius:3px}",
  ".bar-value,.y-ticks,.x-ticks{font-size:12px;color:var(--muted-foreground);font-variant-numeric:tabular-nums}",
  ".axis{margin-bottom:6px}",
  ".axis-x{margin-top:4px;text-align:center}",
  ".plot{display:grid;grid-template-columns:var(--ticks) minmax(0,1fr);column-gap:8px}",
  `.y-ticks{position:relative;height:${PLOT_HEIGHT}px}`,
  ".y-ticks span{position:absolute;right:0;line-height:1;transform:translateY(-50%)}",
  `.plot svg{display:block;width:100%;height:${PLOT_HEIGHT}px;overflow:visible}`,
  ".grid{stroke:var(--grid)}",
  ".line{fill:none;stroke:var(--chart-1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}",
  ".dots{stroke:var(--chart-1);stroke-width:6;stroke-linecap:round}",
  ".x-ticks{grid-column:2;position:relative;height:16px;margin-top:6px}",
  ".x-ticks span{position:absolute;top:0;line-height:1;white-space:nowrap;transform:translateX(-50%)}",
  ".x-ticks .start{transform:none}.x-ticks .end{transform:translateX(-100%)}",
  "img{display:block;max-width:100%;height:auto;border-radius:var(--radius)}",
].join("");

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escape = (text: string) => text.replace(/[&<>"']/g, (char) => ENTITIES[char]!);

const fullNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 20 });
const twoDecimals = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const threeDigits = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 3 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const formatValue = (value: number) =>
  Math.abs(value) >= 1 || value === 0 ? twoDecimals.format(value) : threeDigits.format(value);
const formatTick = (value: number) =>
  Math.abs(value) >= 10_000 ? compact.format(value) : formatValue(value);

const round = (value: number) => Math.round(value * 1_000) / 1_000;
const shorten = (text: string) =>
  text.length > MAX_TICK_LABEL ? `${text.slice(0, MAX_TICK_LABEL - 1)}…` : text;
const gapClass = (gap: "sm" | "md" | "lg" | undefined) =>
  gap === undefined || gap === "md" ? "" : ` gap-${gap}`;

const niceScale = (min: number, max: number) => {
  const pad = min === max ? Math.abs(min) || 1 : 0;
  const low = min - pad;
  const high = max + pad;
  const rough = (high - low) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
  const first = Math.floor(low / step);
  const count = Math.ceil(high / step) - first;
  const ticks = Array.from({ length: count + 1 }, (_, index) =>
    Number(((first + index) * step).toPrecision(12)),
  );
  return { low: ticks[0]!, high: ticks[ticks.length - 1]!, ticks };
};

type Props<T extends HtmlRenderSpecElement["type"]> = Extract<
  HtmlRenderSpecElement,
  { type: T }
>["props"];

const table = ({ headers, rows, caption }: Props<"Table">) => {
  const numeric = headers.map(
    (_, column) => rows.length > 0 && rows.every((row) => typeof row[column] === "number"),
  );
  const cell = (tag: "th" | "td", column: number, content: string) =>
    `<${tag}${numeric[column] ? ' class="num"' : ""}>${content}</${tag}>`;
  return (
    `<figure><div class="scroll"><table><thead><tr>${headers.map((header, column) => cell("th", column, escape(header))).join("")}</tr></thead>` +
    `<tbody>${rows
      .map(
        (row) =>
          `<tr>${row
            .map((value, column) =>
              cell(
                "td",
                column,
                typeof value === "number" ? fullNumber.format(value) : escape(value),
              ),
            )
            .join("")}</tr>`,
      )
      .join("")}</tbody></table></div>` +
    `${caption === undefined ? "" : `<figcaption>${escape(caption)}</figcaption>`}</figure>`
  );
};

const barChart = ({ data, valueLabel }: Props<"BarChart">) => {
  const values = data.map((point) => point.value);
  const low = Math.min(0, ...values);
  const span = Math.max(0, ...values) - low || 1;
  const percent = (value: number) => round((value / span) * 100);
  const bars = data
    .map(({ label, value }) => {
      const text = escape(label);
      return (
        `<span class="bar-label" title="${text}">${text}</span>` +
        `<span class="bar-track"><span class="bar" style="left:${percent(Math.min(value, 0) - low)}%;width:${percent(Math.abs(value))}%"></span></span>` +
        `<span class="bar-value">${formatValue(value)}</span>`
      );
    })
    .join("");
  return (
    `<figure>${valueLabel === undefined ? "" : `<div class="axis">${escape(valueLabel)}</div>`}` +
    `<div class="bars" style="--zero:${percent(-low)}%">${bars}</div></figure>`
  );
};

const lineChart = ({ data, xLabel, yLabel }: Props<"LineChart">) => {
  const values = data.map((point) => point.value);
  const { low, high, ticks } = niceScale(Math.min(...values), Math.max(...values));
  const x = (index: number) => round((index / (data.length - 1)) * PLOT_WIDTH);
  const y = (value: number) => round(((high - value) / (high - low)) * PLOT_HEIGHT);
  const points = data.map(({ value }, index) => `${x(index)} ${y(value)}`);
  const tickLabels = ticks.map(formatTick);
  const stride = Math.ceil((data.length - 1) / (MAX_X_TICKS - 1));
  const xTicks = Array.from(
    { length: Math.floor((data.length - 1) / stride) + 1 },
    (_, tick) => tick * stride,
  );
  const edge = (index: number) =>
    index === 0 ? ' class="start"' : index === data.length - 1 ? ' class="end"' : "";
  const svg =
    `<svg viewBox="0 0 ${PLOT_WIDTH} ${PLOT_HEIGHT}" preserveAspectRatio="none" role="img" aria-label="${escape(yLabel ?? "Line chart")}">` +
    ticks
      .map(
        (tick) =>
          `<path class="grid" d="M0 ${y(tick)}H${PLOT_WIDTH}" vector-effect="non-scaling-stroke"/>`,
      )
      .join("") +
    `<path class="line" d="M${points.join("L")}" vector-effect="non-scaling-stroke"/>` +
    (data.length > MAX_DOTS
      ? ""
      : `<path class="dots" d="${points.map((point) => `M${point}h0`).join("")}" vector-effect="non-scaling-stroke"/>`) +
    "</svg>";
  return (
    `<figure>${yLabel === undefined ? "" : `<div class="axis">${escape(yLabel)}</div>`}` +
    `<div class="plot" style="--ticks:${Math.max(...tickLabels.map((label) => label.length))}ch">` +
    `<div class="y-ticks">${ticks.map((tick, index) => `<span style="top:${round((y(tick) / PLOT_HEIGHT) * 100)}%">${tickLabels[index]}</span>`).join("")}</div>` +
    svg +
    `<div class="x-ticks">${xTicks.map((index) => `<span${edge(index)} style="left:${round((x(index) / PLOT_WIDTH) * 100)}%">${escape(shorten(data[index]!.label))}</span>`).join("")}</div>` +
    `</div>${xLabel === undefined ? "" : `<div class="axis axis-x">${escape(xLabel)}</div>`}</figure>`
  );
};

const render = (spec: HtmlRenderSpec, id: string): string => {
  const element = spec.elements[id]!;
  const children = (ids: ReadonlyArray<string>) => ids.map((child) => render(spec, child)).join("");
  switch (element.type) {
    case "Stack":
      return `<div class="stack${gapClass(element.props.gap)}">${children(element.children)}</div>`;
    case "Columns":
      return `<div class="columns${gapClass(element.props.gap)}" style="--columns:${element.children.length}">${children(element.children)}</div>`;
    case "Text": {
      const text = escape(element.props.text);
      return element.props.variant === "heading"
        ? `<h2>${text}</h2>`
        : `<p${element.props.variant === "caption" ? ' class="caption"' : ""}>${text}</p>`;
    }
    case "Table":
      return table(element.props);
    case "BarChart":
      return barChart(element.props);
    case "LineChart":
      return lineChart(element.props);
    case "Image":
      return (
        `<figure><img src="${escape(element.props.src)}" alt="${escape(element.props.alt)}">` +
        `${element.props.caption === undefined ? "" : `<figcaption>${escape(element.props.caption)}</figcaption>`}</figure>`
      );
  }
};

/** A validated spec as a complete page; theme variables come from the render bootstrap. */
export const compileHtmlRenderSpec = (spec: HtmlRenderSpec) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${render(spec, spec.root)}</body></html>`;
