import { describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const rule = createOxlintRuleHarness("supaterm/no-sparkles-icon", {
  filename: "apps/web/src/components/chat/Example.tsx",
});

describe("supaterm/no-sparkles-icon", () => {
  rule.valid(
    "allows icons that name the action",
    `
      import { BotIcon, ShieldCheckIcon } from "@supaterm/icons";
      import * as IconNodes from "@supaterm/icons/nodes";

      const robot = IconNodes.Bot;

      const icon = <SymbolView name={{ ios: "puzzlepiece", android: "extension" }} />;
    `,
  );

  rule.valid(
    "allows copy and identifiers that mention sparkles",
    `
      const NIGHTLY_SPARKLES = [];
      const label = "Add some sparkles to the release notes";
    `,
  );

  rule.invalid("reports sparkles icons", `import { SparklesIcon } from "@supaterm/icons";`);

  rule.invalid(
    "reports every sparkle variant",
    `import { Sparkle, WandSparklesIcon } from "@supaterm/icons";`,
  );

  rule.invalid("reports named icon nodes", `import { Sparkles } from "@supaterm/icons/nodes";`);

  rule.invalid(
    "reports icon nodes read from a namespace import",
    `
      import * as IconNodes from "@supaterm/icons/nodes";

      const icon = IconNodes.Sparkles;
    `,
  );

  rule.invalid("reports SF Symbol sparkles names", `const icon = <SymbolView name="sparkles" />;`);

  rule.invalid(
    "reports platform symbol objects",
    `const icon = { ios: "wand.and.sparkles", android: "auto_awesome" };`,
  );
});
