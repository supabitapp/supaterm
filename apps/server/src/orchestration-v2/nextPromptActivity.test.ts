import type { OrchestrationV2TurnItem } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { formatNextPromptActivity } from "./nextPromptActivity.ts";

const item = (fields: Record<string, unknown>) =>
  ({ status: "completed", ...fields }) as unknown as OrchestrationV2TurnItem;

const command = (input: string, output: string, exitCode: number) =>
  item({ type: "command_execution", input, output, exitCode });

const edit = (fileName: string, additions: number, deletions: number) =>
  item({ type: "file_change", fileName, additions, deletions });

describe("formatNextPromptActivity", () => {
  it("keeps the end of a failing command's output, where the failed test is named", () => {
    const output = `${"✓ passing test\n".repeat(200)}✗ handles DST in Sydney\n1 failed, 200 passed`;
    const activity = formatNextPromptActivity([command("vp test run src/dates", output, 1)]);

    expect(activity).toContain("ran `vp test run src/dates` (exit 1)");
    expect(activity).toContain("✗ handles DST in Sydney");
    expect(activity).toContain("1 failed, 200 passed");
    expect(activity.length).toBeLessThan(1_000);
  });

  it("lists each edited file once, and the latest todo list", () => {
    const activity = formatNextPromptActivity([
      edit("src/pager.ts", 2, 1),
      edit("src/pager.ts", 1, 0),
      edit("src/pager.test.ts", 8, 0),
      item({
        type: "todo_list",
        steps: [{ text: "write a stale plan", status: "pending" }],
      }),
      item({
        type: "todo_list",
        steps: [
          { text: "fix the bound", status: "completed" },
          { text: "run the tests", status: "pending" },
        ],
      }),
    ]);

    expect(activity).toContain("edited src/pager.ts (+3 -1), src/pager.test.ts (+8 -0)");
    expect(activity).toContain("[x] fix the bound");
    expect(activity).toContain("[ ] run the tests");
    expect(activity).not.toContain("stale plan");
  });

  it("keeps the most recent activity when it does not all fit", () => {
    const commands = Array.from({ length: 40 }, (_, index) =>
      command(`step ${index}`, `${"x".repeat(500)}\nfailure ${index}`, 1),
    );
    const activity = formatNextPromptActivity(commands);

    expect(activity).toContain("failure 39");
    expect(activity).not.toContain("failure 0\n");
    expect(activity.length).toBeLessThanOrEqual(3_000);
  });
});
