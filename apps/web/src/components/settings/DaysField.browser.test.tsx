import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import { DaysField } from "./DaysField";

function SavedDaysField({ onSave }: { onSave: (days: number) => void }) {
  const [days, setDays] = useState(14);
  return (
    <>
      <DaysField
        label="Auto mark-done"
        value={days}
        onCommit={(next) => {
          onSave(next);
          setDays(next);
        }}
      />
      <button type="button">Elsewhere</button>
    </>
  );
}

async function renderField() {
  const onSave = vi.fn();
  const screen = await render(<SavedDaysField onSave={onSave} />, { router: false }); // no routes involved
  return { screen, onSave, input: screen.getByRole("textbox", { name: "Auto mark-done in days" }) };
}

it("restores the saved value when the finished draft is out of range", async () => {
  const { screen, onSave, input } = await renderField();
  await using _screen = screen;
  await userEvent.clear(input);
  await userEvent.type(input, "0");
  await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
  await expect.element(input).toHaveValue("14");
  expect(onSave).not.toHaveBeenCalled();
});

it("saves arrow-key steps once the edit is finished", async () => {
  const { screen, onSave, input } = await renderField();
  await using _screen = screen;
  await userEvent.click(input);
  await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}");
  await expect.element(input).toHaveValue("17");
  expect(onSave).not.toHaveBeenCalled();
  await userEvent.keyboard("{Enter}");
  expect(onSave).toHaveBeenCalledExactlyOnceWith(17);
  await expect.element(input).toHaveFocus();
});

it("Escape cancels a draft without saving it", async () => {
  const { screen, onSave, input } = await renderField();
  await using _screen = screen;
  await userEvent.clear(input);
  await userEvent.type(input, "3");
  const escape = vi.fn();
  window.addEventListener("keydown", escape);
  await userEvent.keyboard("{Escape}");
  window.removeEventListener("keydown", escape);
  await expect.element(input).toHaveValue("14");
  await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(escape).not.toHaveBeenCalled();
});
