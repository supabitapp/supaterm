import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("supaterm/no-low-value-comments");

describe("supaterm/no-low-value-comments", () => {
  rule.valid(
    "allows a comment that says why",
    `
      // The provider drops the socket after 30 s idle, so the ping must beat it.
      export const pingIntervalMs = 25_000;
    `,
  );

  rule.valid(
    "allows directives and linked task markers",
    `
      // oxlint-disable-next-line no-console -- this script reports to the terminal
      console.log("ready");
      // TODO(https://github.com/supabitapp/supaterm/issues/1): drop once the server reports it.
      export const legacy = true;
    `,
  );

  rule.invalid(
    "reports a section divider",
    `
      // ---------- helpers ----------
      export const one = 1;
    `,
    (output) => assert.match(output, /Drop the section divider/),
  );

  rule.invalid(
    "reports a test step label",
    `
      // Arrange
      export const input = 1;
    `,
    (output) => assert.match(output, /Drop the test step label/),
  );

  rule.invalid(
    "reports a task marker without a link",
    `
      // TODO: handle the empty case
      export const items: Array<number> = [];
    `,
    (output) => assert.match(output, /Link the issue/),
  );

  rule.invalid(
    "reports JSDoc types in TypeScript",
    `
      /** @param {number} count how many rows to keep */
      export const keep = (count: number) => count;
    `,
    (output) => assert.match(output, /Drop the JSDoc type/),
  );

  rule.invalid(
    "reports commented-out code",
    `
      // const retries = 3;
      export const attempts = 1;
    `,
    (output) => assert.match(output, /Delete commented-out code/),
  );

  rule.invalid(
    "reports a comment that repeats the name below it",
    `
      // Thread title
      export const threadTitle = "Untitled";
    `,
    (output) => assert.match(output, /only repeats the name below it/),
  );

  rule.valid(
    "allows a four-line comment and a long license header",
    `
      /*!
       * Copyright the authors.
       * Licensed under the MIT license.
       * See the LICENSE file for details.
       * Keep this notice in redistributions.
       */
      // The host rejects batches over 100 rows,
      // and a partial batch still commits,
      // so chunk before sending
      // to keep retries idempotent.
      export const batchSize = 100;
    `,
  );

  rule.invalid(
    "reports a comment block longer than four lines",
    `
      // One.
      // Two.
      // Three.
      // Four.
      // Five.
      export const lines = 5;
    `,
    (output) => assert.match(output, /Cut this to 4 lines or fewer/),
  );

  rule.invalid(
    "reports a bare pull request number",
    `
      // Keeps the cursor stable after #2412.
      export const stable = true;
    `,
    (output) => assert.match(output, /Drop the PR or issue number/),
  );
});
