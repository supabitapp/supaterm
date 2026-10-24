import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { renderDiagram } from "../../../packages/mermaid/src/render.ts";
import { DIAGRAM_LIMITS as limits } from "../../../packages/mermaid/src/diagram.ts";
import fixtures from "../../../packages/mermaid/src/fixtures.json" with { type: "json" };

const WORKLET_BUILD_TIMEOUT_MS = 120_000;

const range = (length: number) => Array.from({ length }, (_, index) => index);
// Ordering edges across subgraphs costs pele millions of steps while still finishing well
// inside the time budget.
const subgraphFlowchart = [
  "flowchart TD",
  ...range(8).flatMap((group) => [
    `subgraph G${group}`,
    ...range(9).map((node) => `  S${group}_${node} --> S${group}_${node + 1}`),
    "end",
  ]),
  ...range(80).map(
    (edge) => `S${edge % 8}_${(edge * 7) % 10} --> S${(edge * 5 + 1) % 8}_${(edge * 3 + 2) % 10}`,
  ),
].join("\n");
const supported = [...fixtures.map((fixture) => fixture.source), subgraphFlowchart];
const rejected = [
  "not a diagram",
  "x".repeat(limits.sourceChars + 1),
  `flowchart LR\n${"A --> B\n".repeat(limits.edges + 1)}`,
];

describe("generated native Mermaid worklet", () => {
  let output: {
    unchanged: boolean;
    platforms: Record<
      string,
      {
        closureSize: number;
        outputs: Array<ReturnType<typeof renderDiagram>>;
        rejectsExpiredBudget: boolean;
        recoversAfterBudget: boolean;
      }
    >;
  };

  beforeAll(() => {
    output = JSON.parse(
      NodeChildProcess.execFileSync(
        process.execPath,
        [NodeURL.fileURLToPath(new URL("./generate-mermaid-worklet.fixture.mjs", import.meta.url))],
        {
          cwd: NodeURL.fileURLToPath(new URL("..", import.meta.url)),
          input: JSON.stringify([...supported, ...rejected]),
          encoding: "utf8",
          timeout: WORKLET_BUILD_TIMEOUT_MS,
        },
      ),
    );
  }, WORKLET_BUILD_TIMEOUT_MS + 5_000);

  it("preserves rendering and work bounds after native Babel serialization", () => {
    const expected = supported.map((source) => renderDiagram(source, { maxWidth: 320, now: 0 }));
    for (const source of rejected) expect(renderDiagram(source)).toBeNull();
    for (const platform of ["ios", "android"]) {
      expect(output.platforms[platform]).toEqual({
        closureSize: 0,
        outputs: [...expected, ...rejected.map(() => null)],
        rejectsExpiredBudget: true,
        recoversAfterBudget: true,
      });
    }
  });

  it("does not trigger a generated module update when renderer output is unchanged", () => {
    expect(output.unchanged).toBe(true);
  });
});
