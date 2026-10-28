import { describe, expect, it } from "vite-plus/test";
import { grade, testRange } from "./grade.ts";
import { cases, caseWorld } from "./cases.ts";

const source = [
  'describe("x", () => {',
  '  it("first", () => {',
  "    expect(1).toBe(1);",
  "  });",
  "",
  '  it("second", () => {});',
  "});",
].join("\n");

describe("grade", () => {
  const target = { path: "a.test.ts", ...testRange(source, "first")! };
  const comment = (line: number) => ({ path: "a.test.ts", line, body: "fold it" });

  it.each([
    ["bad, comment inside the target", "bad", [comment(3)], "", true],
    ["bad, comment on the next test", "bad", [comment(6)], "", false],
    ["guard, nothing posted", "guard", [], "All clear", true],
    ["guard, nothing posted but extra text", "guard", [], "All clear. Nice tests.", false],
    ["guard, a comment", "guard", [comment(3)], "All clear", false],
  ] as const)("%s", (_name, kind, comments, final, pass) => {
    expect(grade({ kind, targets: [target], comments, final }).pass).toBe(pass);
  });
});

describe("captured case inputs", () => {
  it.each(cases)("$id serves its diff, head files and review targets", (entry) => {
    const world = caseWorld(entry);
    expect(world.diff).toMatch(/^diff --git /);
    expect(world.targets).toHaveLength(entry.targets.length);
    for (const [index, target] of world.targets.entries()) {
      const lines = world.files.get(target.path)!.split("\n");
      expect(lines.slice(target.start - 1, target.end).join("\n")).toContain(
        entry.targets[index]!.title,
      );
      expect(world.diff).toContain(entry.targets[index]!.title);
    }
    if (entry.kind === "bad") {
      expect(world.targets.length).toBeGreaterThan(0);
      const target = world.targets[0]!;
      expect(
        grade({
          kind: entry.kind,
          targets: world.targets,
          comments: [
            { path: target.path, line: target.start, body: "Fold this into the existing case." },
          ],
          final: "",
        }).pass,
      ).toBe(true);
      expect(
        grade({ kind: entry.kind, targets: world.targets, comments: [], final: "All clear" }).pass,
      ).toBe(false);
    } else {
      expect(
        grade({ kind: entry.kind, targets: world.targets, comments: [], final: "All clear" }).pass,
      ).toBe(true);
      expect(
        grade({
          kind: entry.kind,
          targets: world.targets,
          comments: [{ path: "unrelated.test.ts", line: 1, body: "Remove this." }],
          final: "All clear",
        }).pass,
      ).toBe(false);
    }
  });
});
