import { getReactI18nCache } from "gt-react-native";
import { describe, expect, it } from "vite-plus/test";

import { discussionCommentCountLabel } from "../features/pull-requests/pullRequestDiffComments";
import { resolveThreadListV2SnoozeMenuSelection } from "../features/threads/threadListV2";
import { relativeTime } from "../lib/time";
import { m, setActiveLocale } from "./messages";
import de from "./translations/de.json";

describe("German catalog", () => {
  it("formats relative times and counts in German", () => {
    getReactI18nCache().updateTranslations({
      de: Object.fromEntries(
        Object.entries(de).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    });
    setActiveLocale("de");
    using _locale = { [Symbol.dispose]: () => setActiveLocale("en") };
    const now = Date.parse("2026-11-26T12:00:00Z");
    expect(relativeTime("2026-10-28T12:00:00Z", now, m)).toBe("29 T.");
    expect(discussionCommentCountLabel(3, m)).toBe("3 Kommentare");
  });

  it("labels a picked snooze preset in German", () => {
    using _locale = inGerman();
    const selection = resolveThreadListV2SnoozeMenuSelection({
      event: "snooze:after:60",
      displayedPresets: [],
      now: new Date("2026-11-26T12:00:00Z"),
      presets: undefined,
    });
    expect(selection._tag === "selected" && selection.preset.label).toBe("In 1 Stunde");
  });
});
