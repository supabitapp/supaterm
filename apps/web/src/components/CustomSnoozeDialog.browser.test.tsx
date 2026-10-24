import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

import { act, fakeTimers, render } from "../../test/render";
import { CustomSnoozeDialogHost, requestCustomSnooze } from "./CustomSnoozeDialog";

const dayCell = (isoDate: string) => document.querySelector(`[data-day="${isoDate}"]`);

it("stops offering today once midnight passes with the dialog open", async () => {
  using _timers = fakeTimers();
  vi.setSystemTime(new Date(2026, 9, 24, 23, 59, 30));
  await using _screen = await render(<CustomSnoozeDialogHost />);
  await act(async () => {
    void requestCustomSnooze();
  });
  await act(async () => {
    page
      .getByRole("button", { name: "Date" })
      .element()
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  expect(dayCell("2026-10-23")?.hasAttribute("data-disabled")).toBe(true);
  expect(dayCell("2026-10-24")?.hasAttribute("data-disabled")).toBe(false);

  await act(async () => {
    vi.advanceTimersByTime(60_000);
  });

  expect(dayCell("2026-10-24")?.hasAttribute("data-disabled")).toBe(true);
  expect(dayCell("2026-10-25")?.hasAttribute("data-disabled")).toBe(false);
});
