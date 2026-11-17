import { DEFAULT_UNIFIED_SETTINGS } from "@supaterm/contracts/settings";
import * as Schema from "effect/Schema";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, fakeTimers, render } from "../../../test/render";
import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { getLocalStorageItem, removeLocalStorageItem } from "../../hooks/useLocalStorage";
import { TypographySection } from "./TypographySettings";

const state = vi.hoisted(() => ({
  searchTargetId: null as string | null,
  updateSettings: vi.fn(),
}));

vi.mock(import("./useScopedSettings"), async (original) => ({
  ...(await original()),
  useScopedSettings: (() => DEFAULT_UNIFIED_SETTINGS) as never,
  useUpdateScopedSettings: (() => state.updateSettings) as never,
}));
// The previews mount Ghostty and Shiki, which this test does not exercise.
vi.mock(import("./SettingsFontPreviews"), () => ({
  CodeFontPreview: () => <div />,
  PromptFontPreview: () => <div />,
  TerminalFontPreview: () => <div />,
}));
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  useSettingsSearchTargetId: () => state.searchTargetId,
}));

function setup(searchTargetId: string | null) {
  state.searchTargetId = searchTargetId;
  state.updateSettings = vi.fn();
  removeLocalStorageItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY);
  return { [Symbol.dispose]: () => removeLocalStorageItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY) };
}

describe("TypographySection", () => {
  it("persists the advanced flag the terminal reads when a deep link targets an advanced row", async () => {
    using _storage = setup("terminal-font");
    await using screen = await render(<TypographySection />);

    await expect.element(screen.getByRole("heading", { name: "Terminal font" })).toBeVisible();
    expect(getLocalStorageItem(TYPOGRAPHY_ADVANCED_STORAGE_KEY, Schema.Boolean)).toBe(true);
  });

  it("waits for IME composition to end before Enter commits a font family", async () => {
    using _storage = setup(null);
    await using screen = await render(<TypographySection />);
    // The field also commits on a 400ms debounce, which must not stand in for Enter.
    using _timers = fakeTimers();
    const family = screen.getByRole("textbox", { name: "Interface font family" });
    await family.fill("serif");

    for (const composition of [
      { isComposing: true, keyCode: 13 },
      { isComposing: false, keyCode: 229 },
    ]) {
      const event = new KeyboardEvent("keydown", { key: "Enter", ...composition, bubbles: true });
      await act(() => family.element().dispatchEvent(event));
      expect(state.updateSettings, JSON.stringify(composition)).not.toHaveBeenCalled();
    }

    await userEvent.keyboard("{Enter}");
    expect(state.updateSettings).toHaveBeenCalledExactlyOnceWith({ fontFamilySans: "serif" });
  });
});
