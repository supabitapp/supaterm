import { DEFAULT_UNIFIED_SETTINGS } from "@supaterm/contracts";
import * as Duration from "effect/Duration";
import { describe, expect, it } from "vite-plus/test";
import {
  autoMarkDoneDaysField,
  type AutoMarkDoneDaysField,
  backgroundActivitySharedPolicySettings,
  cancelAutoMarkDoneDaysField,
  commitAutoMarkDoneDaysField,
  editAutoMarkDoneDaysField,
  failAutoMarkDoneDaysField,
  getChangedBrowserSettingLabels,
  hasChangedBackgroundActivitySettings,
  syncAutoMarkDoneDaysField,
} from "./SettingsPanels.logic";

describe("background activity settings restore", () => {
  it("detects a changed structured setting", () => {
    expect(hasChangedBackgroundActivitySettings(DEFAULT_UNIFIED_SETTINGS)).toBe(false);
    expect(
      hasChangedBackgroundActivitySettings({
        backgroundActivity: { schemaVersion: 1, profile: "performance", overrides: {} },
      }),
    ).toBe(true);
  });

  it("preserves advanced overrides when the shared policy changes", () => {
    const automaticGitFetchInterval = Duration.seconds(42);
    expect(
      backgroundActivitySharedPolicySettings(
        {
          ...DEFAULT_UNIFIED_SETTINGS,
          backgroundActivity: {
            schemaVersion: 1,
            profile: "custom",
            baseProfile: "balanced",
            overrides: {
              automaticGitFetchInterval,
              pauseWhenOnBattery: true,
            },
          },
        },
        "performance",
      ),
    ).toEqual({
      schemaVersion: 1,
      profile: "custom",
      baseProfile: "performance",
      overrides: {
        automaticGitFetchInterval,
        pauseWhenOnBattery: true,
      },
    });
  });
});

describe("getChangedBrowserSettingLabels", () => {
  it("counts a retained custom search URL so restore clears it", () => {
    expect(
      getChangedBrowserSettingLabels({
        ...DEFAULT_UNIFIED_SETTINGS,
        browserCustomSearchUrl: "https://search.example/?q=%s",
      }),
    ).toEqual(["Search engine"]);
  });
});

describe("auto-mark-done days field", () => {
  const type = (field: AutoMarkDoneDaysField, ...drafts: string[]) =>
    drafts.reduce(editAutoMarkDoneDaysField, field);

  it("saves only the finished edit, never a value typed on the way", () => {
    const typed = type(autoMarkDoneDaysField(14), "1", "", "3", "30");
    expect(typed.pending).toBeNull();

    const committed = commitAutoMarkDoneDaysField(typed);
    expect(committed.submit).toBe(30);
    expect(commitAutoMarkDoneDaysField(committed.field).submit).toBeNull();

    const confirmed = syncAutoMarkDoneDaysField(committed.field, 30);
    expect(confirmed).toMatchObject({ saved: 30, draft: "30", pending: null });
  });

  it.each(["", "0", "91", "1.5", "abc"])("restores the saved value for %j", (draft) => {
    const committed = commitAutoMarkDoneDaysField(type(autoMarkDoneDaysField(14), draft));
    expect(committed.submit).toBeNull();
    expect(committed.field.draft).toBe("14");
  });

  it("a rejected save falls back to the saved value and can be retried", () => {
    const submitted = commitAutoMarkDoneDaysField(type(autoMarkDoneDaysField(14), "30")).field;
    expect(failAutoMarkDoneDaysField(submitted, submitted.revision).draft).toBe("14");

    const rejectedWhileCleared = failAutoMarkDoneDaysField(type(submitted, ""), submitted.revision);
    expect(rejectedWhileCleared.draft).toBe("");
    expect(commitAutoMarkDoneDaysField(rejectedWhileCleared).field.draft).toBe("14");
    expect(commitAutoMarkDoneDaysField(type(rejectedWhileCleared, "30")).submit).toBe(30);
  });

  it("retyping a value that saved on only some environments sends it again", () => {
    const submitted = commitAutoMarkDoneDaysField(type(autoMarkDoneDaysField(14), "30")).field;
    const partlySaved = failAutoMarkDoneDaysField(
      syncAutoMarkDoneDaysField(submitted, 30),
      submitted.revision,
    );
    expect(commitAutoMarkDoneDaysField(partlySaved).submit).toBeNull();
    expect(commitAutoMarkDoneDaysField(type(partlySaved, "3", "30")).submit).toBe(30);
  });

  it("returning to the saved value while another save is in flight saves it again", () => {
    const submitted = commitAutoMarkDoneDaysField(type(autoMarkDoneDaysField(14), "30")).field;
    const back = commitAutoMarkDoneDaysField(type(submitted, "14"));
    expect(back.submit).toBe(14);
    expect(failAutoMarkDoneDaysField(back.field, submitted.revision)).toBe(back.field);

    const settled = syncAutoMarkDoneDaysField(back.field, 14);
    expect(settled.pending).toBeNull();
    expect(syncAutoMarkDoneDaysField(settled, 14)).toBe(settled);
    expect(syncAutoMarkDoneDaysField(settled, 20).draft).toBe("20");
  });

  it("keeps a later save in flight when an earlier one is confirmed", () => {
    const first = commitAutoMarkDoneDaysField(type(autoMarkDoneDaysField(14), "30")).field;
    const second = commitAutoMarkDoneDaysField(type(first, "60")).field;
    const firstConfirmed = syncAutoMarkDoneDaysField(second, 30);
    expect(firstConfirmed).toMatchObject({ saved: 30, draft: "60", pending: 60 });
    expect(failAutoMarkDoneDaysField(firstConfirmed, second.revision)).toMatchObject({
      draft: "30",
      pending: null,
    });
  });

  it("a cancelled edit restores the saved value and saves nothing", () => {
    const cancelled = cancelAutoMarkDoneDaysField(type(autoMarkDoneDaysField(14), "1"));
    expect(cancelled).toMatchObject({ draft: "14", dirty: false });
    expect(commitAutoMarkDoneDaysField(cancelled).submit).toBeNull();
  });

  it("keeps a draft in progress when the saved value changes underneath it", () => {
    const typing = type(autoMarkDoneDaysField(14), "4");
    expect(syncAutoMarkDoneDaysField(typing, 30)).toMatchObject({ saved: 30, draft: "4" });
  });
});
