import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import type { ProjectIconOverride } from "@supaterm/contracts";

import { act, render } from "../../../test/render";
import { ProjectIconPickerDialog } from "./ProjectIconPickerDialog";

const automatic = { monogram: "TT", color: "teal" } as const;

function button(name: string) {
  return vi.waitFor(() => {
    const match = [...document.querySelectorAll<HTMLElement>("button, [role='radio']")].find(
      (element) => element.getAttribute("aria-label") === name || element.textContent === name,
    );
    if (!match) throw new Error(`No button ${name}`);
    return match;
  });
}

// The modal's inert backdrop covers the unstyled popup, so Playwright pointer clicks land on it.
async function click(name: string) {
  const target = await button(name);
  await act(async () => target.click());
}

async function openPicker(current: ProjectIconOverride | null = null) {
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  const screen = await render(
    <ProjectIconPickerDialog
      current={current}
      automatic={automatic}
      open
      onOpenChange={onOpenChange}
      onSelect={onSelect}
    />,
  );
  return Object.assign(screen, { onSelect, onOpenChange });
}

describe("ProjectIconPickerDialog", () => {
  it("starts an automatic project on icons in its derived color and saves the picked icon", async () => {
    await using screen = await openPicker();
    const { onSelect, onOpenChange } = screen;
    expect((await button("Icons")).getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelector('[aria-label="Icon color"] [aria-pressed="true"]'),
    ).not.toBeNull();

    await userEvent.fill(searchBox(), "rocket");
    await click("Rocket");
    await click("Save icon");

    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      kind: "icon",
      name: "rocket",
      color: automatic.color,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps a saved icon the picker no longer offers when only the color changes", async () => {
    await using screen = await openPicker({
      kind: "lucide",
      name: "alarm-clock-check",
      color: "red",
    });
    await click("Blue");
    await click("Save icon");

    expect(screen.onSelect).toHaveBeenCalledExactlyOnceWith({
      kind: "lucide",
      name: "alarm-clock-check",
      color: "blue",
    });
  });

  it("saves a monogram only once the letters are letters or numbers", async () => {
    await using screen = await openPicker();
    const { onSelect } = screen;
    await click("Monogram");
    const letters = await vi.waitFor(() => {
      const input = document.querySelector<HTMLInputElement>("#project-monogram");
      if (!input) throw new Error("No monogram input");
      return input;
    });

    await userEvent.fill(letters, "t-3");
    await click("Save icon");
    expect(onSelect).not.toHaveBeenCalled();

    await userEvent.fill(letters, "supaterm");
    await click("Save icon");
    expect(onSelect).not.toHaveBeenCalled();

    await userEvent.fill(letters, "s3");
    await click("Save icon");
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({
      kind: "monogram",
      text: "S3",
      color: automatic.color,
    });
  });

  it("clears the icon search on Escape without closing the dialog", async () => {
    await using screen = await openPicker();
    const search = page.getByRole("searchbox", { name: "Search icons" });
    await expect.element(search).toHaveAttribute("type", "text");
    await userEvent.fill(search, "rocket");
    for (const composition of [
      { key: "Escape", isComposing: true, keyCode: 27 },
      { key: "Escape", isComposing: false, keyCode: 229 },
    ]) {
      // Safari ends the composition just before the Escape keydown.
      await act(() => {
        search.element().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
        search
          .element()
          .dispatchEvent(new KeyboardEvent("keydown", { ...composition, bubbles: true }));
      });
      await expect.element(search).toHaveValue("rocket");
    }

    await userEvent.keyboard("{Escape}");
    await expect.element(search).toHaveValue("");
    await expect.element(search).toHaveFocus();
    // Holding Escape repeats the keydown, which must not also close the dialog.
    await act(() => {
      search
        .element()
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", repeat: true, bubbles: true }),
        );
    });
    expect(screen.onOpenChange).not.toHaveBeenCalled();

    await userEvent.keyboard("{Escape}");
    expect(screen.onOpenChange.mock.calls.map(([open]) => open)).toEqual([false]);
  });
});

function searchBox() {
  return document.querySelector<HTMLInputElement>('input[aria-label="Search icons"]')!;
}
