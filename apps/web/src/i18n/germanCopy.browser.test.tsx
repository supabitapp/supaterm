import { EnvironmentId } from "@supaterm/contracts";
import { formatDuration } from "@supaterm/shared/orchestrationTimingCopy";
import { getReactI18nCache, GTProvider, initializeGTSPA, msg } from "gt-react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { render } from "../../test/render";
import { summarizePullRequestChecks } from "../components/pullRequest/pullRequestPresentation";
import { SidebarSnoozeButton } from "../components/sidebar/SidebarSnoozeButton";
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

// Rendered `<T>` entries are arrays the provider's prop type rejects; these tests read only strings.
const germanStrings = Object.fromEntries(
  Object.entries(de).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

function German(props: { readonly children: ReactNode }) {
  return (
    <GTProvider locale="de" translations={{ de: germanStrings }}>
      {props.children}
    </GTProvider>
  );
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

  it("offers the snooze menu presets in German", async () => {
    using _locale = await inGerman();
    await using _screen = await render(
      <German>
        <SidebarSnoozeButton
          open
          onOpenChange={() => {}}
          onSnooze={() => {}}
          environmentId={EnvironmentId.make("environment:local")}
        />
      </German>,
    );
    await expect.element(page.getByRole("menuitem", { name: /^In 1 Stunde/ })).toBeVisible();
    await expect.element(page.getByRole("menuitem", { name: /^Morgen/ })).toBeVisible();
  });
});
