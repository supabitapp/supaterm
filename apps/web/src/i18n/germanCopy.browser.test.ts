import { formatDuration } from "@supaterm/shared/orchestrationTimingCopy";
import { getReactI18nCache, initializeGTSPA, msg } from "gt-react";
import { describe, expect, it } from "vite-plus/test";

import { summarizePullRequestChecks } from "../components/pullRequest/pullRequestPresentation";
import { formatWorkingDurationLabel } from "@supaterm/client-runtime/state/thread-timing";
import { m, setActiveLocale } from "./messages";
import de from "./translations/de.json";

async function inGerman() {
  await initializeGTSPA({
    defaultLocale: "en",
    locales: ["en", "de"],
    locale: "de",
    loadTranslations: async () => de,
    cacheExpiryTime: null,
  });
  await getReactI18nCache().loadTranslations("de");
  setActiveLocale("de");
  return { [Symbol.dispose]: () => setActiveLocale("en") };
}

describe("German catalog", () => {
  it("renders copy that used to stay English", async () => {
    using _locale = await inGerman();
    expect(m(msg("Worked for {duration}", { duration: formatDuration(5_100, m) }))).toBe(
      "5.1 s gearbeitet",
    );
    expect(m(msg("Balanced"))).toBe("Ausgewogen");
    expect(m(msg("Uncommitted"))).toBe("Lokal");
    expect(formatWorkingDurationLabel(125_000, m)).toBe("2 Min.");
  });

  it("summarizes pull request checks", async () => {
    using _locale = await inGerman();
    expect(
      summarizePullRequestChecks(
        [{ name: "ci", status: "success", description: null, url: null }],
        m,
      ),
    ).toBe("1 erfolgreich Check");
  });
});
