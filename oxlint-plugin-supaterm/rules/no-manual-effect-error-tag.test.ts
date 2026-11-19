import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("supaterm/no-manual-effect-error-tag");

describe("supaterm/no-manual-effect-error-tag", () => {
  rule.valid(
    "allows tag checks outside a catch handler",
    `
      export const isNotFound = (error: { readonly _tag: string }) => error._tag === "NotFound";
    `,
  );

  rule.valid(
    "allows reason checks inside a narrow catchTags handler",
    `
      import * as Effect from "effect/Effect";

      declare const program: Effect.Effect<void, { readonly _tag: "Wrapper"; readonly reason: { readonly _tag: string } }>;

      export const recovered = program.pipe(
        Effect.catchTags({
          Wrapper: (error) => (error.reason._tag === "Timeout" ? Effect.void : Effect.fail(error)),
        }),
      );
    `,
  );

  rule.invalid(
    "reports a tag comparison in Effect.catchIf",
    `
      import * as Effect from "effect/Effect";

      declare const program: Effect.Effect<void, { readonly _tag: "A" } | { readonly _tag: "B" }>;

      export const recovered = program.pipe(
        Effect.catchIf(
          (error) => error._tag !== "A",
          () => Effect.void,
        ),
      );
    `,
    (output) => {
      assert.match(output, /Effect\.catchTags/);
    },
  );

  rule.invalid(
    "reports a reason tag comparison",
    `
      import * as Effect from "effect/Effect";

      declare const program: Effect.Effect<void, { readonly _tag: "E"; readonly reason: { readonly _tag: string } }>;

      export const recovered = program.pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "AlreadyExists",
          () => Effect.void,
        ),
      );
    `,
    (output) => {
      assert.match(output, /Effect\.catchReasons/);
    },
  );

  rule.invalid(
    "reports a tag switch in Effect.catch",
    `
      import * as Effect from "effect/Effect";

      declare const program: Effect.Effect<void, { readonly _tag: "A" } | { readonly _tag: "B" }>;

      export const recovered = program.pipe(
        Effect.catch((error) => {
          switch (error._tag) {
            case "A":
              return Effect.void;
            default:
              return Effect.fail(error);
          }
        }),
      );
    `,
    (output) => {
      assert.match(output, /Effect\.catchTags/);
    },
  );
});
