import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE = "supaterm/no-test-timeout-or-retry";
const rule = createOxlintRuleHarness(RULE, { filename: "fixture.test.ts" });

const assertTimeoutMessage = (output: string) =>
  assert.match(output, /project timeout is the ceiling/);

describe(RULE, () => {
  rule.valid(
    "allows tests without overrides, conditional skips, and waitFor timeouts",
    `
      import { describe, it, vi } from "vitest";

      describe.skipIf(process.env.CI)("suite", () => {
        it.runIf(true)("runs", async () => {
          await vi.waitFor(() => {}, { timeout: 10_000 });
        });
        it.each([1, 2])("handles %s", (value) => {});
      });
      vi.setConfig({ restoreMocks: true });
    `,
  );

  rule.invalid(
    "reports a numeric timeout on it.effect",
    `
      import { it } from "@effect/vitest";
      import * as Effect from "effect/Effect";

      it.effect("slow", () => Effect.void, 20_000);
    `,
    assertTimeoutMessage,
  );

  rule.invalid(
    "reports a timeout through .each and .skipIf chains",
    `
      import { it } from "@effect/vitest";
      import * as Effect from "effect/Effect";

      it.live.skipIf(false)("slow", () => Effect.void, 5_000);
      it.effect.each([1])("case %s", () => Effect.void, { timeout: 1_000 });
    `,
    (output) => {
      assertTimeoutMessage(output);
      assert.equal(output.match(/no-test-timeout-or-retry/g)?.length, 2);
    },
  );

  rule.invalid(
    "reports retry options, options-first timeouts, and hook timeouts",
    `
      import { beforeAll, describe, it } from "vitest";

      describe("suite", () => {
        beforeAll(() => {}, 60_000);
        it("flaky", () => {}, { retry: 3 });
        it("slow", { timeout: 30_000 }, () => {});
      });
    `,
    (output) => {
      assertTimeoutMessage(output);
      assert.equal(output.match(/no-test-timeout-or-retry/g)?.length, 3);
    },
  );

  rule.invalid(
    "reports a describe-level timeout",
    `
      import { describe, it } from "vitest";

      describe("suite", () => {
        it("runs", () => {});
      }, 120_000);
    `,
    assertTimeoutMessage,
  );

  rule.invalid(
    "reports vi.setConfig timeouts",
    `
      import { vi } from "vitest";

      vi.setConfig({ testTimeout: 30_000 });
    `,
    assertTimeoutMessage,
  );

  rule.invalid(
    "flags an options-object timeout when the callback is a reference",
    `
      import { it } from "vitest";
      const run = async () => {};
      it("slow", { timeout: 30_000 }, run);
    `,
    assertTimeoutMessage,
  );
});

createOxlintRuleHarness(RULE, { filename: "Provider.live.test.ts" }).valid(
  "allows timeouts in opt-in live provider suites",
  `
    import { it } from "@effect/vitest";
    import * as Effect from "effect/Effect";

    it.live("real turn", () => Effect.void, 360_000);
  `,
);

createOxlintRuleHarness(RULE).valid(
  "ignores non-test files",
  `
    const it = (_name: string, _fn: () => void, _ms: number) => {};
    it("x", () => {}, 1_000);
  `,
);
