import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { renderDiagram } from "../../../packages/mermaid/src/render.ts";
import { DIAGRAM_LIMITS as limits } from "../../../packages/mermaid/src/diagram.ts";
import fixtures from "../../../packages/mermaid/src/fixtures.json" with { type: "json" };

const supported = fixtures.map((fixture) => fixture.source);
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
          timeout: 30_000,
        },
      ),
    );
  }, 30_000);

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
