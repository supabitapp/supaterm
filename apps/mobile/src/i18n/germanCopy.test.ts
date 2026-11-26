import { getReactI18nCache, msg } from "gt-react-native";
import { describe, expect, it, vi } from "vite-plus/test";

import { discussionCommentCountLabel } from "../features/pull-requests/pullRequestDiffComments";
import { resolveThreadListV2SnoozeMenuSelection } from "../features/threads/threadListV2";
import { relativeTime } from "../lib/time";
import { m, setActiveLocale } from "./messages";
import de from "./translations/de.json";
import en from "./translations/en.json";

const english: Readonly<Record<string, unknown>> = en;
const german: Readonly<Record<string, unknown>> = de;

// The test build of GT knows only English, so lookups read the shipped German catalog by source.
function inGerman() {
  const lookup = vi
    .spyOn(getReactI18nCache(), "lookupTranslation")
    .mockImplementation((_locale, source) => {
      const values = new Set(
        Object.keys(english)
          .filter((key) => english[key] === source)
          .map((key) => german[key]),
      );
      const [value] = values;
      return values.size === 1 && typeof value === "string" ? value : undefined;
    });
  setActiveLocale("de");
  return {
    [Symbol.dispose]: () => {
      setActiveLocale("en");
      lookup.mockRestore();
    },
  };
}

describe("German catalog", () => {
  it("renders the settings rows and list switcher in German", () => {
    using _locale = inGerman();
    expect(
      ["Keyboard", "Voice transcription", "Maintenance", "About", "Pull requests"].map((source) =>
        m(msg(source)),
      ),
    ).toEqual(["Tastatur", "Sprachtranskription", "Wartung", "Info", "Pull Requests"]);
  });

  it("formats relative times and counts in German", () => {
    using _locale = inGerman();
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
