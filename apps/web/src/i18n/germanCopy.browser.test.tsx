import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId } from "@supaterm/contracts";
import { formatDuration } from "@supaterm/shared/orchestrationTimingCopy";
import { AtomRegistry } from "effect/reactivity";
import { getReactI18nCache, GTProvider, initializeGTSPA, msg } from "gt-react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { fakeTimers, render } from "../../test/render";
import { summarizePullRequestChecks } from "../components/pullRequest/pullRequestPresentation";
import { SidebarSnoozeButton } from "../components/sidebar/SidebarSnoozeButton";
import { SidebarRelativeTime } from "../components/sidebar/SidebarThreadRow";
import { SidebarThreadUndoNotice } from "../components/sidebar/SidebarThreadUndoNotice";
import { useThreadUndoNotice } from "../hooks/showThreadUndoNotice";
import { primaryServerKeybindingsAtom } from "../state/server";
import { formatRelativeTimeLabel } from "../timestampFormat";
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

  it("ends the cleanup last-run line with one period after an abbreviated time", async () => {
    using _locale = await inGerman();
    const when = formatRelativeTimeLabel(
      "2026-11-26T11:55:00Z",
      Date.parse("2026-11-26T12:00:00Z"),
      m,
    );
    expect(m(msg("Last run {when}. {bytes} recovered.", { when, bytes: "0 B" }))).toBe(
      "Letzte Ausführung vor 5 Min., 0 B freigegeben.",
    );
    expect(
      m(
        msg(
          "{count, plural, one {Last run {when}. {bytes} recovered. {count} item couldn't be removed.} other {Last run {when}. {bytes} recovered. {count} items couldn't be removed.}}",
          { count: 2, when, bytes: "0 B" },
        ),
      ),
    ).toBe(
      "Letzte Ausführung vor 5 Min., 0 B freigegeben. 2 Elemente konnten nicht entfernt werden.",
    );
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

  it("summarizes the sidebar undo notice in German", async () => {
    using _locale = await inGerman();
    useThreadUndoNotice.setState({ notice: { action: "Snoozed", count: 2, undo: async () => {} } });
    using _notice = { [Symbol.dispose]: () => useThreadUndoNotice.setState({ notice: null }) };
    const registry = AtomRegistry.make({ initialValues: [[primaryServerKeybindingsAtom, []]] });
    using _registry = { [Symbol.dispose]: () => registry.dispose() };
    await using screen = await render(
      <RegistryContext.Provider value={registry}>
        <German>
          <SidebarThreadUndoNotice />
        </German>
      </RegistryContext.Provider>,
    );
    await expect.element(screen.getByText("2 zurückgestellt,")).toBeVisible();
  });

  it("switches sidebar relative times to German with the language", async () => {
    using _timers = fakeTimers();
    vi.setSystemTime(Date.parse("2026-11-26T12:00:30Z"));
    const ui = (locale: string) => (
      <GTProvider locale={locale} translations={{ en: {}, de: germanStrings }}>
        <SidebarRelativeTime timestamp="2026-11-26T09:00:00Z" />
      </GTProvider>
    );
    await using screen = await render(ui("en"));
    expect(screen.container.textContent).toBe("3h");

    using _locale = await inGerman();
    await screen.rerender(ui("de"));
    expect(screen.container.textContent).toBe("3 Std.");
  });
});
