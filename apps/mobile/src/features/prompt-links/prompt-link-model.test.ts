import { parseNewThreadLink } from "@supaterm/shared/promptLinks";
import { describe, expect, it } from "vite-plus/test";

import { promptLinkSearchFromParams } from "./prompt-link-model";

describe("promptLinkSearchFromParams", () => {
  it("round-trips decoded route params into the shared parser", () => {
    const search = promptLinkSearchFromParams({
      prompt: "Fix the bug & add tests = done?",
      repo: ["supabitapp/supacode-next", "ignored/second"],
      provider: "codex",
      screen: "NewTask",
    });

    expect(parseNewThreadLink(search ?? "")).toEqual({
      ok: true,
      value: {
        kind: "new",
        prompt: { text: "Fix the bug & add tests = done?", hiddenCharacters: 0 },
        repository: { owner: "supabitapp", name: "supacode-next" },
        provider: "codex",
        model: null,
      },
    });
  });
});
