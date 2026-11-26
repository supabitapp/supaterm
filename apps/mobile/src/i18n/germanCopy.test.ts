import { getReactI18nCache } from "gt-react-native";
import { describe, expect, it } from "vite-plus/test";

import { discussionCommentCountLabel } from "../features/pull-requests/pullRequestDiffComments";
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
});
